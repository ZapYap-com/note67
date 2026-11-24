use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::engine::{Engine, TranscriptionResult};
use super::TranscriptionError;

/// Transcribes audio files with a loaded [`Engine`].
///
/// Holds the engine behind an `Arc` rather than loading its own copy: the live
/// path shares the same one, so the weights are in memory once.
pub struct Transcriber {
    engine: Arc<Engine>,
    is_transcribing: AtomicBool,
}

impl Transcriber {
    /// Wrap an already-loaded engine.
    pub fn new(engine: Arc<Engine>) -> Self {
        Self {
            engine,
            is_transcribing: AtomicBool::new(false),
        }
    }

    /// Transcribe an audio file. `language` is a note67 language code such as
    /// "en" or "zh"; None auto-detects.
    ///
    /// Fails with [`TranscriptionError::LanguageNotSupported`] when the loaded
    /// model cannot write that language — Parakeet covers 25 European
    /// languages and nothing else.
    pub fn transcribe(
        &self,
        audio_path: &Path,
        language: Option<&str>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        if self.is_transcribing.swap(true, Ordering::SeqCst) {
            return Err(TranscriptionError::AlreadyTranscribing);
        }

        let result = self.transcribe_internal(audio_path, language);
        self.is_transcribing.store(false, Ordering::SeqCst);
        result
    }

    fn transcribe_internal(
        &self,
        audio_path: &Path,
        language: Option<&str>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        if !audio_path.exists() {
            return Err(TranscriptionError::AudioNotFound(
                audio_path.to_string_lossy().to_string(),
            ));
        }

        let samples = load_audio(audio_path)?;
        self.engine.transcribe_long(&samples, language)
    }
}

/// Load an audio file as 16 kHz mono f32 samples, which is what both engines
/// take.
fn load_audio(audio_path: &Path) -> Result<Vec<f32>, TranscriptionError> {
    let reader = hound::WavReader::open(audio_path)
        .map_err(|e| TranscriptionError::TranscriptionFailed(format!("Failed to open WAV: {}", e)))?;

    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let channels = spec.channels as usize;

    // Read samples based on format
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => {
            reader.into_samples::<f32>().filter_map(|s| s.ok()).collect()
        }
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            let max_val = (1 << (bits - 1)) as f32;
            reader
                .into_samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / max_val)
                .collect()
        }
    };

    // Convert to mono if stereo
    let mono_samples: Vec<f32> = if channels > 1 {
        samples
            .chunks(channels)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples
    };

    // Resample to 16kHz if needed (both engines require 16kHz)
    let target_rate = 16000;
    let resampled = if sample_rate != target_rate {
        resample(&mono_samples, sample_rate, target_rate)
    } else {
        mono_samples
    };

    Ok(resampled)
}

/// Simple linear resampling (for basic use; a proper resampler would be better for production)
pub(crate) fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = to_rate as f64 / from_rate as f64;
    let new_len = (samples.len() as f64 * ratio) as usize;
    let mut result = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_idx = i as f64 / ratio;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(samples.len() - 1);
        let frac = src_idx - idx0 as f64;

        let sample = samples[idx0] as f64 * (1.0 - frac) + samples[idx1] as f64 * frac;
        result.push(sample as f32);
    }

    result
}
