//! Audio mixing utilities for combining multiple WAV files.

use std::path::Path;

use hound::{SampleFormat, WavReader, WavSpec, WavWriter};

use crate::audio::AudioError;

/// Simple linear interpolation resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let new_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut resampled = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_idx = i as f64 * ratio;
        let idx_floor = src_idx.floor() as usize;
        let idx_ceil = (idx_floor + 1).min(samples.len() - 1);
        let frac = src_idx - idx_floor as f64;

        let sample = if idx_floor < samples.len() {
            let s1 = samples[idx_floor];
            let s2 = samples.get(idx_ceil).copied().unwrap_or(s1);
            s1 + (s2 - s1) * frac as f32
        } else {
            0.0
        };
        resampled.push(sample);
    }

    resampled
}

/// Read a WAV into normalized f32 samples (interleaved), whatever its format.
fn read_wav_as_f32(path: &Path) -> Result<(Vec<f32>, WavSpec), AudioError> {
    let mut reader = WavReader::open(path)?;
    let spec = reader.spec();

    let samples: Vec<f32> = match spec.sample_format {
        SampleFormat::Float => reader.samples::<f32>().filter_map(|s| s.ok()).collect(),
        SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / scale)
                .collect()
        }
    };

    Ok((samples, spec))
}

/// Build one playback track for a whole note: mix each recording segment's mic
/// and system audio, then concatenate the segments in order.
///
/// A note can hold several segments (pause/resume, or continuing a finished
/// recording). Playback used to be rebuilt from only the segment that had just
/// stopped, so everything recorded earlier silently vanished from the audio the
/// user could play back — the transcript kept it, the audio did not.
///
/// `segments` is `(mic, optional system)` in playback order. A segment whose mic
/// file is missing is skipped rather than aborting the whole track; losing one
/// segment beats losing all of them.
///
/// The track is written beside `output` and renamed into place. Creating the
/// output first truncated it before any input was read, so when an input was
/// also the output (a legacy `{note_id}.wav` recording) the recording was
/// destroyed: 5.76 MB became a 44-byte header. Writing aside also means a
/// failed build never leaves a half-written track behind.
pub fn build_playback_track(
    segments: &[(std::path::PathBuf, Option<std::path::PathBuf>)],
    output: &Path,
) -> Result<(), AudioError> {
    let tmp = output.with_extension("wav.tmp");
    let written = write_playback_track(segments, &tmp)
        .and_then(|()| std::fs::rename(&tmp, output).map_err(AudioError::IoError));
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

fn write_playback_track(
    segments: &[(std::path::PathBuf, Option<std::path::PathBuf>)],
    output: &Path,
) -> Result<(), AudioError> {
    let first_mic = segments
        .iter()
        .map(|(mic, _)| mic)
        .find(|mic| mic.exists())
        .ok_or_else(|| {
            AudioError::IoError(std::io::Error::other("no readable audio segments"))
        })?;

    // Everything is converted to the first segment's format so the concatenated
    // file has one consistent spec.
    let (_, first_spec) = read_wav_as_f32(first_mic)?;
    let target_channels = first_spec.channels;
    let target_rate = first_spec.sample_rate;

    let mut writer = WavWriter::create(
        output,
        WavSpec {
            channels: target_channels,
            sample_rate: target_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        },
    )?;

    let to_target = |samples: &[f32], spec: WavSpec| -> Vec<f32> {
        let remixed = normalize_channels_f32(samples, spec.channels, target_channels);
        resample(&remixed, spec.sample_rate, target_rate)
    };

    for (mic_path, system_path) in segments {
        if !mic_path.exists() {
            eprintln!("Playback: skipping missing segment {}", mic_path.display());
            continue;
        }

        let (mic_raw, mic_spec) = read_wav_as_f32(mic_path)?;
        let mic = to_target(&mic_raw, mic_spec);

        let system = match system_path {
            Some(p) if p.exists() => {
                let (raw, spec) = read_wav_as_f32(p)?;
                to_target(&raw, spec)
            }
            _ => Vec::new(),
        };

        let len = mic.len().max(system.len());
        for i in 0..len {
            let a = mic.get(i).copied().unwrap_or(0.0);
            let mixed = if system.is_empty() {
                // Nothing to mix against — halving here would quietly drop a
                // mic-only segment 6dB below the rest of the track.
                a
            } else {
                (a + system.get(i).copied().unwrap_or(0.0)) / 2.0
            };
            let sample =
                (mixed * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
            writer.write_sample(sample)?;
        }
    }

    writer.finalize()?;
    Ok(())
}

/// Mix two WAV files into a single output file.
///
/// Both input files should have the same sample rate and channel count.
/// If they differ, the function will use the first file's format and resample
/// or remix the second file as needed.
///
/// The mixing is done by averaging samples from both sources to prevent clipping.
fn normalize_channels_f32(samples: &[f32], from_channels: u16, to_channels: u16) -> Vec<f32> {
    if from_channels == to_channels {
        return samples.to_vec();
    }

    match (from_channels, to_channels) {
        (1, 2) => {
            // Mono to stereo - duplicate each sample
            samples.iter().flat_map(|&s| [s, s]).collect()
        }
        (2, 1) => {
            // Stereo to mono - average pairs
            samples
                .chunks(2)
                .map(|chunk| {
                    if chunk.len() == 2 {
                        (chunk[0] + chunk[1]) / 2.0
                    } else {
                        chunk[0]
                    }
                })
                .collect()
        }
        _ => {
            // For other channel counts, just take what we have
            samples.to_vec()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Write a WAV of `frames` frames, every sample set to `amplitude`.
    fn write_wav(path: &std::path::Path, channels: u16, frames: usize, amplitude: i16) {
        let spec = WavSpec {
            channels,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).expect("create wav");
        for i in 0..frames {
            for _ in 0..channels {
                // Alternate sign so the content has energy rather than DC.
                let s = if i % 2 == 0 { amplitude } else { -amplitude };
                w.write_sample(s).expect("write sample");
            }
        }
        w.finalize().expect("finalize");
    }

    fn rms_of(path: &std::path::Path) -> f64 {
        let mut r = WavReader::open(path).expect("open output");
        let samples: Vec<i32> = r.samples::<i32>().map(|s| s.expect("read sample")).collect();
        if samples.is_empty() {
            return 0.0;
        }
        (samples.iter().map(|&s| (s as f64) * (s as f64)).sum::<f64>() / samples.len() as f64).sqrt()
    }

    #[test]
    fn playback_track_can_overwrite_one_of_its_own_inputs() {
        // A legacy mic-only recording is stored as {note_id}.wav, the same name
        // the combined track used to be written to. Building over it used to
        // truncate the recording before reading it.
        let dir = std::env::temp_dir().join("note67_playback_self_overwrite");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let recording = dir.join("note.wav");
        write_wav(&recording, 1, 48_000, 6_000); // 1s

        build_playback_track(&[(recording.clone(), None)], &recording).expect("build playback");

        let r = WavReader::open(&recording).expect("open recording");
        assert_eq!(r.duration(), 48_000, "the recording was truncated");
        assert!(rms_of(&recording) > 1_000.0, "the recording lost its audio");
        assert!(!recording.with_extension("wav.tmp").exists(), "temp file left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_playback_build_leaves_the_existing_track_alone() {
        let dir = std::env::temp_dir().join("note67_playback_failed_build");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let out = dir.join("playback.wav");
        write_wav(&out, 1, 48_000, 6_000);

        let missing = dir.join("missing.wav");
        assert!(build_playback_track(&[(missing, None)], &out).is_err());
        assert_eq!(WavReader::open(&out).expect("open").duration(), 48_000);
        assert!(!out.with_extension("wav.tmp").exists(), "temp file left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A real session produced a completely silent playback file even though its
    /// mic input had audio, because the system-audio side was silent. Mixing
    /// with a silent partner must preserve the other side, not blank both.
    #[test]
    fn playback_track_keeps_audio_when_system_is_silent() {
        // The original report: a session's playback was pure silence because the
        // system side had none. Mixing against a silent partner must halve the
        // level, not erase it.
        let dir = std::env::temp_dir().join("note67_playback_silent_partner");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let mic = dir.join("mic.wav");
        let sys = dir.join("sys.wav");
        let out = dir.join("playback.wav");

        write_wav(&mic, 1, 48_000, 8_000);
        write_wav(&sys, 2, 48_000, 0);

        build_playback_track(&[(mic, Some(sys))], &out).expect("build playback");

        let rms = rms_of(&out);
        assert!(rms > 1_000.0, "playback went silent when one side was (rms {rms})");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn playback_track_concatenates_every_segment() {
        // The regression: playback was rebuilt from only the segment that had
        // just stopped, so continuing a recording silently dropped the audio of
        // everything before it.
        let dir = std::env::temp_dir().join("note67_playback_concat");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let (m0, s0) = (dir.join("m0.wav"), dir.join("s0.wav"));
        let (m1, s1) = (dir.join("m1.wav"), dir.join("s1.wav"));
        let out = dir.join("playback.wav");

        write_wav(&m0, 1, 48_000, 4_000); // 1s
        write_wav(&s0, 1, 48_000, 4_000);
        write_wav(&m1, 1, 24_000, 4_000); // 0.5s
        write_wav(&s1, 1, 24_000, 4_000);

        build_playback_track(
            &[(m0, Some(s0)), (m1, Some(s1))],
            &out,
        )
        .expect("build playback");

        let r = WavReader::open(&out).expect("open output");
        // 1s + 0.5s at the first segment's 48kHz.
        assert_eq!(r.duration(), 72_000, "segments were not concatenated");
        assert!(rms_of(&out) > 100.0, "playback should carry audio");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn playback_track_keeps_a_mic_only_segment_at_full_level() {
        // No system audio to mix against: halving would drop that stretch 6dB
        // below the rest of the track.
        let dir = std::env::temp_dir().join("note67_playback_mic_only");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let mic = dir.join("m.wav");
        let out = dir.join("playback.wav");
        write_wav(&mic, 1, 48_000, 8_000);

        build_playback_track(&[(mic, None)], &out).expect("build playback");

        let rms = rms_of(&out);
        assert!(rms > 7_000.0, "mic-only segment was attenuated (rms {rms})");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn playback_track_skips_a_missing_segment_rather_than_failing() {
        let dir = std::env::temp_dir().join("note67_playback_missing");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let good = dir.join("good.wav");
        let out = dir.join("playback.wav");
        write_wav(&good, 1, 48_000, 4_000);

        build_playback_track(
            &[(good, None), (dir.join("gone.wav"), None)],
            &out,
        )
        .expect("a missing segment must not abort the whole track");

        assert!(rms_of(&out) > 100.0);

        let _ = std::fs::remove_dir_all(&dir);
    }

}
