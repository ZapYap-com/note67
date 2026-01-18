//! Audio format conversion module for uploaded files.
//!
//! Converts various audio formats to 16-bit mono WAV at 16kHz for Whisper transcription.
//! Uses Symphonia for decoding (pure Rust, no external dependencies).

use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::AudioError;

/// Supported input formats for upload
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "flac", "ogg", "wav", "webm", "mkv", "mp4",
];

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
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Unsupported audio format: {}", e),
            ))
        })?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "No audio track found",
            ))
        })?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    // Get source sample rate for resampling calculation
    let source_sample_rate = codec_params.sample_rate.unwrap_or(44100);

    // Create decoder
    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &decoder_opts)
        .map_err(|e| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to create decoder: {}", e),
            ))
        })?;

    // Collect all samples
    let mut all_samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break; // End of stream
            }
            Err(e) => {
                // Log but continue on decode errors
                eprintln!("Error reading packet: {}", e);
                continue;
            }
        };

        // Skip packets from other tracks
        if packet.track_id() != track_id {
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

        // Initialize sample buffer on first packet
        if sample_buf.is_none() {
            let spec = *decoded.spec();
            let capacity = decoded.capacity() as u64;
            sample_buf = Some(SampleBuffer::new(capacity, spec));
        }

        // Copy samples to buffer
        if let Some(buf) = &mut sample_buf {
            buf.copy_interleaved_ref(decoded);
            all_samples.extend_from_slice(buf.samples());
        }
    }

    if all_samples.is_empty() {
        return Err(AudioError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "No audio samples decoded",
        )));
    }

    // Get channel count from decoder
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2);

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

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| {
            AudioError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Cannot probe audio file: {}", e),
            ))
        })?;

    let format = probed.format;

    // Find the first audio track
    if let Some(track) = format.tracks().first() {
        if let Some(n_frames) = track.codec_params.n_frames {
            let sample_rate = track.codec_params.sample_rate.unwrap_or(44100) as u64;
            let duration_ms = (n_frames * 1000) / sample_rate;
            return Ok(duration_ms as i64);
        }

        // Fallback: use time base if available
        if let Some(time_base) = track.codec_params.time_base {
            if let Some(n_frames) = track.codec_params.n_frames {
                let duration_secs =
                    (n_frames as f64 * time_base.numer as f64) / time_base.denom as f64;
                return Ok((duration_secs * 1000.0) as i64);
            }
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

    #[test]
    fn test_resample() {
        // Simple test: resample 4 samples from 2Hz to 1Hz should give 2 samples
        let samples = vec![1.0, 2.0, 3.0, 4.0];
        let resampled = resample(&samples, 2, 1);
        assert_eq!(resampled.len(), 2);
    }
}
