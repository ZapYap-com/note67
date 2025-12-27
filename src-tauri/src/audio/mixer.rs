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

/// Mix two WAV files into a single output file.
///
/// Both input files should have the same sample rate and channel count.
/// If they differ, the function will use the first file's format and resample
/// or remix the second file as needed.
///
/// The mixing is done by averaging samples from both sources to prevent clipping.
pub fn mix_wav_files(
    file_a: &Path,
    file_b: &Path,
    output: &Path,
) -> Result<(), AudioError> {
    // Open both input files
    let mut reader_a = WavReader::open(file_a)?;
    let mut reader_b = WavReader::open(file_b)?;

    let spec_a = reader_a.spec();
    let spec_b = reader_b.spec();

    // Use file A's spec for output, but ensure we handle format differences
    let output_spec = WavSpec {
        channels: spec_a.channels,
        sample_rate: spec_a.sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let mut writer = WavWriter::create(output, output_spec)?;

    // Read samples based on the format
    match (spec_a.sample_format, spec_b.sample_format) {
        (SampleFormat::Int, SampleFormat::Int) => {
            mix_int_samples(&mut reader_a, &mut reader_b, &mut writer, spec_a, spec_b)?;
        }
        (SampleFormat::Float, SampleFormat::Float) => {
            mix_float_samples(&mut reader_a, &mut reader_b, &mut writer, spec_a, spec_b)?;
        }
        _ => {
            // Mixed formats - convert to float, mix, convert back
            mix_mixed_samples(&mut reader_a, &mut reader_b, &mut writer, spec_a, spec_b)?;
        }
    }

    writer.finalize()?;
    Ok(())
}

fn mix_int_samples<R1: std::io::Read, R2: std::io::Read, W: std::io::Write + std::io::Seek>(
    reader_a: &mut WavReader<R1>,
    reader_b: &mut WavReader<R2>,
    writer: &mut WavWriter<W>,
    spec_a: WavSpec,
    spec_b: WavSpec,
) -> Result<(), AudioError> {
    // Convert to float for processing
    let samples_a: Vec<f32> = reader_a
        .samples::<i32>()
        .filter_map(|s| s.ok())
        .map(|s| s as f32 / i32::MAX as f32)
        .collect();
    let samples_b: Vec<f32> = reader_b
        .samples::<i32>()
        .filter_map(|s| s.ok())
        .map(|s| s as f32 / i32::MAX as f32)
        .collect();

    // Handle different channel counts
    let samples_a = normalize_channels_f32(&samples_a, spec_a.channels, spec_a.channels);
    let samples_b = normalize_channels_f32(&samples_b, spec_b.channels, spec_a.channels);

    // Resample if needed to match sample rates
    let samples_b = resample(&samples_b, spec_b.sample_rate, spec_a.sample_rate);

    let max_len = samples_a.len().max(samples_b.len());

    for i in 0..max_len {
        let a = samples_a.get(i).copied().unwrap_or(0.0);
        let b = samples_b.get(i).copied().unwrap_or(0.0);

        // Mix by averaging to prevent clipping
        let mixed = (a + b) / 2.0;

        // Convert to i16
        let sample = (mixed * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer.write_sample(sample)?;
    }

    Ok(())
}

fn mix_float_samples<R1: std::io::Read, R2: std::io::Read, W: std::io::Write + std::io::Seek>(
    reader_a: &mut WavReader<R1>,
    reader_b: &mut WavReader<R2>,
    writer: &mut WavWriter<W>,
    spec_a: WavSpec,
    spec_b: WavSpec,
) -> Result<(), AudioError> {
    let samples_a: Vec<f32> = reader_a.samples::<f32>().filter_map(|s| s.ok()).collect();
    let samples_b: Vec<f32> = reader_b.samples::<f32>().filter_map(|s| s.ok()).collect();

    // Handle different channel counts
    let samples_a = normalize_channels_f32(&samples_a, spec_a.channels, spec_a.channels);
    let samples_b = normalize_channels_f32(&samples_b, spec_b.channels, spec_a.channels);

    // Resample if needed to match sample rates
    let samples_b = resample(&samples_b, spec_b.sample_rate, spec_a.sample_rate);

    let max_len = samples_a.len().max(samples_b.len());

    for i in 0..max_len {
        let a = samples_a.get(i).copied().unwrap_or(0.0);
        let b = samples_b.get(i).copied().unwrap_or(0.0);

        // Mix by averaging
        let mixed = (a + b) / 2.0;

        // Convert to i16
        let sample = (mixed * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer.write_sample(sample)?;
    }

    Ok(())
}

fn mix_mixed_samples<R1: std::io::Read, R2: std::io::Read, W: std::io::Write + std::io::Seek>(
    reader_a: &mut WavReader<R1>,
    reader_b: &mut WavReader<R2>,
    writer: &mut WavWriter<W>,
    spec_a: WavSpec,
    spec_b: WavSpec,
) -> Result<(), AudioError> {
    // Convert both to float for mixing
    let samples_a: Vec<f32> = if spec_a.sample_format == SampleFormat::Float {
        reader_a.samples::<f32>().filter_map(|s| s.ok()).collect()
    } else {
        reader_a
            .samples::<i32>()
            .filter_map(|s| s.ok())
            .map(|s| s as f32 / i32::MAX as f32)
            .collect()
    };

    let samples_b: Vec<f32> = if spec_b.sample_format == SampleFormat::Float {
        reader_b.samples::<f32>().filter_map(|s| s.ok()).collect()
    } else {
        reader_b
            .samples::<i32>()
            .filter_map(|s| s.ok())
            .map(|s| s as f32 / i32::MAX as f32)
            .collect()
    };

    // Handle different channel counts
    let samples_a = normalize_channels_f32(&samples_a, spec_a.channels, spec_a.channels);
    let samples_b = normalize_channels_f32(&samples_b, spec_b.channels, spec_a.channels);

    // Resample if needed to match sample rates
    let samples_b = resample(&samples_b, spec_b.sample_rate, spec_a.sample_rate);

    let max_len = samples_a.len().max(samples_b.len());

    for i in 0..max_len {
        let a = samples_a.get(i).copied().unwrap_or(0.0);
        let b = samples_b.get(i).copied().unwrap_or(0.0);

        let mixed = (a + b) / 2.0;
        let sample = (mixed * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer.write_sample(sample)?;
    }

    Ok(())
}

/// Normalize channel count - convert between mono/stereo as needed (i32 version)
#[allow(dead_code)]
fn normalize_channels(samples: &[i32], from_channels: u16, to_channels: u16) -> Vec<i32> {
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
                        ((chunk[0] as i64 + chunk[1] as i64) / 2) as i32
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

/// Normalize channel count - convert between mono/stereo as needed (f32 version)
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
    use std::io::Cursor;

    #[test]
    fn test_normalize_channels_mono_to_stereo() {
        let mono = vec![100, 200, 300];
        let stereo = normalize_channels(&mono, 1, 2);
        assert_eq!(stereo, vec![100, 100, 200, 200, 300, 300]);
    }

    #[test]
    fn test_normalize_channels_stereo_to_mono() {
        let stereo = vec![100, 200, 300, 400];
        let mono = normalize_channels(&stereo, 2, 1);
        assert_eq!(mono, vec![150, 350]);
    }
}
