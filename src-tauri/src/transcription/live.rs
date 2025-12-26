use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::interval;

use crate::audio::RecordingState;
use crate::transcription::{TranscriptionError, TranscriptionResult, TranscriptionSegment};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

/// Live transcription state
pub struct LiveTranscriptionState {
    pub is_running: AtomicBool,
    /// Offset in seconds for segment timestamps
    pub time_offset: Mutex<f64>,
    /// Accumulated segments
    pub segments: Mutex<Vec<TranscriptionSegment>>,
}

impl LiveTranscriptionState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            time_offset: Mutex::new(0.0),
            segments: Mutex::new(Vec::new()),
        }
    }
}

impl Default for LiveTranscriptionState {
    fn default() -> Self {
        Self::new()
    }
}

/// Event payload for transcription updates
#[derive(Clone, serde::Serialize)]
pub struct TranscriptionUpdateEvent {
    pub meeting_id: String,
    pub segments: Vec<TranscriptionSegment>,
    pub is_final: bool,
}

/// Start live transcription
/// Runs every 10 seconds, transcribes accumulated audio, emits events
pub async fn start_live_transcription(
    app: AppHandle,
    meeting_id: String,
    recording_state: Arc<RecordingState>,
    live_state: Arc<LiveTranscriptionState>,
    whisper_ctx: Arc<WhisperContext>,
) -> Result<(), TranscriptionError> {
    if live_state.is_running.swap(true, Ordering::SeqCst) {
        return Err(TranscriptionError::AlreadyTranscribing);
    }

    // Reset state
    *live_state.time_offset.lock().await = 0.0;
    live_state.segments.lock().await.clear();

    let app_clone = app.clone();
    let meeting_id_clone = meeting_id.clone();
    let recording_state_clone = recording_state.clone();
    let live_state_clone = live_state.clone();
    let whisper_ctx_clone = whisper_ctx.clone();

    // Spawn the live transcription task
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(5));

        loop {
            ticker.tick().await;

            // Check if we should stop
            if !live_state_clone.is_running.load(Ordering::SeqCst) {
                break;
            }

            // Check if still recording
            if !recording_state_clone.is_recording.load(Ordering::SeqCst) {
                break;
            }

            // Get audio buffer
            let samples = recording_state_clone.take_audio_buffer();
            if samples.is_empty() {
                continue;
            }

            let sample_rate = recording_state_clone.sample_rate.load(Ordering::SeqCst);
            let channels = recording_state_clone.channels.load(Ordering::SeqCst) as usize;

            if sample_rate == 0 || channels == 0 {
                continue;
            }

            // Process audio in blocking task
            let whisper_ctx = whisper_ctx_clone.clone();
            let time_offset = *live_state_clone.time_offset.lock().await;

            let result = tokio::task::spawn_blocking(move || {
                transcribe_samples(&whisper_ctx, &samples, sample_rate, channels, time_offset)
            })
            .await;

            match result {
                Ok(Ok(transcription)) => {
                    if !transcription.segments.is_empty() {
                        // Update time offset for next chunk
                        if let Some(last) = transcription.segments.last() {
                            *live_state_clone.time_offset.lock().await = last.end_time;
                        }

                        // Store segments
                        live_state_clone
                            .segments
                            .lock()
                            .await
                            .extend(transcription.segments.clone());

                        // Emit event
                        let event = TranscriptionUpdateEvent {
                            meeting_id: meeting_id_clone.clone(),
                            segments: transcription.segments,
                            is_final: false,
                        };

                        let _ = app_clone.emit("transcription-update", event);
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Live transcription error: {}", e);
                }
                Err(e) => {
                    eprintln!("Live transcription task error: {}", e);
                }
            }
        }

        live_state_clone.is_running.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Stop live transcription and return final result
pub async fn stop_live_transcription(
    live_state: Arc<LiveTranscriptionState>,
) -> TranscriptionResult {
    live_state.is_running.store(false, Ordering::SeqCst);

    let segments = live_state.segments.lock().await.clone();
    let full_text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    TranscriptionResult {
        segments,
        full_text,
        language: Some("en".to_string()),
    }
}

/// Transcribe raw audio samples
fn transcribe_samples(
    ctx: &WhisperContext,
    samples: &[f32],
    sample_rate: u32,
    channels: usize,
    time_offset: f64,
) -> Result<TranscriptionResult, TranscriptionError> {
    // Convert to mono if needed
    let mono_samples: Vec<f32> = if channels > 1 {
        samples
            .chunks(channels)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples.to_vec()
    };

    // Resample to 16kHz
    let target_rate = 16000;
    let resampled = if sample_rate != target_rate {
        resample(&mono_samples, sample_rate, target_rate)
    } else {
        mono_samples
    };

    // Create whisper state
    let mut state = ctx
        .create_state()
        .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

    // Set up transcription parameters
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);
    params.set_n_threads(num_cpus());

    // Run transcription
    state
        .full(params, &resampled)
        .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

    // Extract segments
    let num_segments = state
        .full_n_segments()
        .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

    let mut segments = Vec::new();
    let mut full_text = String::new();

    for i in 0..num_segments {
        let start_time = state
            .full_get_segment_t0(i)
            .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?
            as f64
            / 100.0
            + time_offset;

        let end_time = state
            .full_get_segment_t1(i)
            .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?
            as f64
            / 100.0
            + time_offset;

        let text = state
            .full_get_segment_text(i)
            .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

        let text = text.trim().to_string();
        if !text.is_empty() {
            if !full_text.is_empty() {
                full_text.push(' ');
            }
            full_text.push_str(&text);

            segments.push(TranscriptionSegment {
                start_time,
                end_time,
                text,
            });
        }
    }

    Ok(TranscriptionResult {
        segments,
        full_text,
        language: Some("en".to_string()),
    })
}

fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8)
}

fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = to_rate as f64 / from_rate as f64;
    let new_len = (samples.len() as f64 * ratio) as usize;
    let mut result = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_idx = i as f64 / ratio;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(samples.len().saturating_sub(1));
        let frac = src_idx - idx0 as f64;

        if idx0 < samples.len() {
            let sample = samples[idx0] as f64 * (1.0 - frac)
                + samples.get(idx1).copied().unwrap_or(0.0) as f64 * frac;
            result.push(sample as f32);
        }
    }

    result
}
