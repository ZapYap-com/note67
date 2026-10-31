//! Audio format conversion module for uploaded files.
//!
//! Converts various audio formats to 16-bit mono WAV at 16kHz for Whisper transcription.
//! Uses Symphonia for decoding (pure Rust, no external dependencies).

use std::fs::File;
use std::path::Path;

use symphonia::core::codecs::audio::well_known::CODEC_ID_OPUS;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use super::AudioError;

/// File types the import picker offers and the converter accepts. The picker
/// asks the backend for this list, so the two can't disagree again (it offered
/// .wma, which was always rejected, and hid .mp4 and .mkv, which work).
///
/// No .webm: it almost always carries Opus, which Symphonia 0.6 can't decode.
/// .ogg stays because Vorbis decodes; an Opus .ogg gets `OPUS_UNSUPPORTED`.
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "flac", "ogg", "wav", "mkv", "mp4",
];

const OPUS_UNSUPPORTED: &str =
    "Opus audio isn't supported yet. Convert it to m4a or mp3 and upload it again.";

/// Check if a file has a supported audio format
pub fn is_supported_format(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Convert an audio file to 16-bit mono WAV at 16kHz for Whisper.
///
/// Uses Symphonia for decoding and hound for WAV output.
/// Supports: MP3, M4A/AAC, ALAC, FLAC, OGG/Vorbis, WAV, WebM, MKV
pub fn convert_to_wav(input_path: &Path, output_path: &Path) -> Result<(), AudioError> {
    // Open the input file
    let file = File::open(input_path).map_err(AudioError::IoError)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Create a hint to help format detection
    let mut hint = Hint::new();
    if let Some(ext) = input_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    // Probe the format
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, format_opts, metadata_opts)
        .map_err(|e| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Unsupported audio format: {}", e),
            ))
        })?;

    // Find the first audio track
    let track = format.default_track(TrackType::Audio).ok_or_else(|| {
        AudioError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "No audio track found",
        ))
    })?;

    let track_id = track.id;
    let codec_params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .cloned()
        .ok_or_else(|| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "No audio track found",
            ))
        })?;

    if codec_params.codec == CODEC_ID_OPUS {
        return Err(AudioError::UnsupportedCodec(OPUS_UNSUPPORTED.to_string()));
    }

    // Create decoder
    let decoder_opts = AudioDecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&codec_params, &decoder_opts)
        .map_err(|_| {
            AudioError::UnsupportedCodec(
                "This file's audio codec isn't supported. Convert it to m4a or mp3 and upload it again."
                    .to_string(),
            )
        })?;

    // Collect all samples
    let mut all_samples: Vec<f32> = Vec::new();
    let mut packet_samples: Vec<f32> = Vec::new();
    let mut decoded_spec: Option<(u32, usize)> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break, // End of stream
            Err(SymphoniaError::DecodeError(e)) => {
                // A damaged packet: skip it and keep going
                eprintln!("Error reading packet: {}", e);
                continue;
            }
            // Anything else (I/O, reset) won't get better on the next read;
            // keep what decoded so far.
            Err(e) => {
                eprintln!("Error reading packet: {}", e);
                break;
            }
        };

        // Skip packets from other tracks
        if packet.track_id != track_id {
            continue;
        }

        // Decode the packet
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(e) => {
                eprintln!("Error decoding packet: {}", e);
                continue;
            }
        };

        if decoded_spec.is_none() {
            let spec = decoded.spec();
            decoded_spec = Some((spec.rate(), spec.channels().count()));
        }

        decoded.copy_to_vec_interleaved(&mut packet_samples);
        all_samples.extend_from_slice(&packet_samples);
    }

    if all_samples.is_empty() {
        return Err(AudioError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "No audio samples decoded",
        )));
    }

    // Channels and rate as the decoder actually produced them, not as the
    // container claims. An MP4 track often doesn't state its channel count, and
    // the old fallback of 2 averaged a mono recording's samples in pairs: a
    // 5 s mono voice memo came out 2.5 s long, at double speed.
    let Some((source_sample_rate, channels)) = decoded_spec else {
        return Err(AudioError::UnsupportedFormat);
    };
    let channels = channels.max(1);

    // Convert to mono if stereo (average channels)
    let mono_samples: Vec<f32> = if channels > 1 {
        all_samples
            .chunks(channels)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        all_samples
    };

    // Resample to 16kHz using linear interpolation
    let target_rate = 16000u32;
    let resampled = resample(&mono_samples, source_sample_rate, target_rate);

    // Write to WAV using hound
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: target_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(output_path, spec)?;

    for sample in &resampled {
        // Convert f32 [-1.0, 1.0] to i16
        let sample_i16 = (*sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer.write_sample(sample_i16)?;
    }

    writer.finalize()?;

    Ok(())
}

/// Linear interpolation resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = ((samples.len() as f64) / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 * ratio;
        let idx_floor = src_idx.floor() as usize;
        let idx_ceil = (idx_floor + 1).min(samples.len() - 1);
        let frac = src_idx - idx_floor as f64;

        let sample = if idx_floor < samples.len() {
            let s1 = samples[idx_floor];
            let s2 = samples[idx_ceil];
            s1 + (s2 - s1) * frac as f32
        } else {
            0.0
        };

        output.push(sample);
    }

    output
}

/// Get the duration of an audio file in milliseconds.
pub fn get_audio_duration_ms(path: &Path) -> Result<i64, AudioError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // For WAV files, use hound (faster)
    if ext == "wav" {
        return get_wav_duration_ms(path);
    }

    // For other formats, use Symphonia
    let file = File::open(path).map_err(AudioError::IoError)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension(&ext);

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let format = symphonia::default::get_probe()
        .probe(&hint, mss, format_opts, metadata_opts)
        .map_err(|e| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Cannot probe audio file: {}", e),
            ))
        })?;

    // Find the first audio track
    if let Some(track) = format.default_track(TrackType::Audio) {
        // The container's duration, in its own timebase
        if let (Some(time_base), Some(duration)) = (track.time_base, track.duration)
            && let Some(time) = time_base.calc_duration(duration)
        {
            return Ok(time.as_millis() as i64);
        }

        // Fallback: frame count at the codec's sample rate
        if let Some(n_frames) = track.num_frames {
            let sample_rate = track
                .codec_params
                .as_ref()
                .and_then(|p| p.audio())
                .and_then(|p| p.sample_rate)
                .unwrap_or(44100) as u64;
            return Ok(((n_frames * 1000) / sample_rate) as i64);
        }
    }

    // Duration unknown
    Ok(0)
}

/// Get WAV file duration using hound
fn get_wav_duration_ms(path: &Path) -> Result<i64, AudioError> {
    let reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let num_samples = reader.len() as u64;
    let duration_ms = (num_samples * 1000) / (spec.sample_rate as u64 * spec.channels as u64);
    Ok(duration_ms as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_formats() {
        assert!(is_supported_format(Path::new("test.mp3")));
        assert!(is_supported_format(Path::new("test.M4A")));
        assert!(is_supported_format(Path::new("test.wav")));
        assert!(is_supported_format(Path::new("test.flac")));
        assert!(is_supported_format(Path::new("test.ogg")));
        assert!(!is_supported_format(Path::new("test.txt")));
        assert!(!is_supported_format(Path::new("test.pdf")));
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/audio")
            .join(name)
    }

    #[test]
    fn aac_and_vorbis_imports_convert() {
        let dir = std::env::temp_dir().join("note67_convert_ok");
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["tone.m4a", "tone_vorbis.ogg"] {
            let out = dir.join(format!("{name}.wav"));
            convert_to_wav(&fixture(name), &out).unwrap_or_else(|e| panic!("{name}: {e}"));
            // Both fixtures are 0.5 s. The mono AAC one came out 288 ms: its
            // samples were averaged in pairs as if it were stereo.
            let ms = get_audio_duration_ms(&out).unwrap();
            assert!((450..=700).contains(&ms), "{name} converted to {ms} ms");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn opus_imports_say_so() {
        let out = std::env::temp_dir().join("note67_convert_opus.wav");
        for name in ["tone_opus.ogg", "tone_opus.webm"] {
            let err = convert_to_wav(&fixture(name), &out).unwrap_err().to_string();
            assert_eq!(err, OPUS_UNSUPPORTED, "{name}");
        }
    }

    #[test]
    fn webm_is_not_offered_and_mp4_is() {
        assert!(!is_supported_format(Path::new("voice.webm")));
        assert!(!is_supported_format(Path::new("call.wma")));
        assert!(is_supported_format(Path::new("call.mp4")));
        assert!(is_supported_format(Path::new("call.mkv")));
    }

    #[test]
    fn test_resample() {
        // Simple test: resample 4 samples from 2Hz to 1Hz should give 2 samples
        let samples = vec![1.0, 2.0, 3.0, 4.0];
        let resampled = resample(&samples, 2, 1);
        assert_eq!(resampled.len(), 2);
    }
}
