use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::interval;

use crate::audio::{aec, take_system_audio_samples, RecordingState};
use crate::db::Database;
use crate::transcription::{TranscriptionError, TranscriptionResult, TranscriptionSegment};
use tauri::Manager;

/// Buffer to store recent system audio samples for AEC reference
static SYSTEM_AUDIO_REFERENCE: std::sync::OnceLock<std::sync::Mutex<Vec<f32>>> = std::sync::OnceLock::new();

fn get_system_audio_reference() -> &'static std::sync::Mutex<Vec<f32>> {
    SYSTEM_AUDIO_REFERENCE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Store system audio samples as AEC reference
fn store_reference_samples(samples: &[f32]) {
    if let Ok(mut buffer) = get_system_audio_reference().lock() {
        // Keep last 5 seconds of audio at 16kHz (80000 samples)
        const MAX_SAMPLES: usize = 80000;
        buffer.extend_from_slice(samples);
        if buffer.len() > MAX_SAMPLES {
            let drain_count = buffer.len() - MAX_SAMPLES;
            buffer.drain(0..drain_count);
        }
    }
}

/// Get reference samples for AEC
fn get_reference_samples(count: usize) -> Vec<f32> {
    if let Ok(buffer) = get_system_audio_reference().lock() {
        if buffer.len() >= count {
            buffer[buffer.len() - count..].to_vec()
        } else {
            buffer.clone()
        }
    } else {
        Vec::new()
    }
}

/// Clear reference buffer
fn clear_reference_buffer() {
    if let Ok(mut buffer) = get_system_audio_reference().lock() {
        buffer.clear();
    }
}

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

/// Check if a transcript segment should be skipped (blank audio, inaudible, etc.)
fn should_skip_segment(text: &str) -> bool {
    let text_lower = text.to_lowercase();
    // Skip common Whisper artifacts for silence/noise
    text_lower.contains("[blank_audio]")
        || text_lower.contains("[inaudible]")
        || text_lower.contains("[ inaudible ]")
        || text_lower.contains("[silence]")
        || text_lower.contains("[music]")
        || text_lower.contains("[applause]")
        || text_lower.contains("[laughter]")
        || text.trim().is_empty()
}

/// Live transcription state
pub struct LiveTranscriptionState {
    pub is_running: AtomicBool,
    /// Offset in seconds for mic segment timestamps
    pub mic_time_offset: Mutex<f64>,
    /// Offset in seconds for system audio segment timestamps
    pub system_time_offset: Mutex<f64>,
    /// Accumulated segments
    pub segments: Mutex<Vec<TranscriptionSegment>>,
}

impl LiveTranscriptionState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            mic_time_offset: Mutex::new(0.0),
            system_time_offset: Mutex::new(0.0),
            segments: Mutex::new(Vec::new()),
        }
    }
}

impl Default for LiveTranscriptionState {
    fn default() -> Self {
        Self::new()
    }
}

/// Audio source for transcription
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioSource {
    /// Microphone input (the user)
    Mic,
    /// System audio (other participants)
    System,
}

/// Event payload for transcription updates
#[derive(Clone, serde::Serialize)]
pub struct TranscriptionUpdateEvent {
    pub meeting_id: String,
    pub segments: Vec<TranscriptionSegment>,
    pub is_final: bool,
    /// The source of the audio (mic or system)
    pub audio_source: AudioSource,
}

/// Start live transcription
/// Runs every 5 seconds, transcribes accumulated audio, saves to DB, emits events
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
    *live_state.mic_time_offset.lock().await = 0.0;
    *live_state.system_time_offset.lock().await = 0.0;
    live_state.segments.lock().await.clear();

    // Initialize AEC for echo cancellation (16kHz sample rate)
    aec::init_aec(16000);
    clear_reference_buffer();

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

            // Get audio buffers - both mic and system audio
            let mic_samples = recording_state_clone.take_audio_buffer();
            let system_samples = take_system_audio_samples();

            // Store system audio as AEC reference (before any processing)
            if !system_samples.is_empty() {
                store_reference_samples(&system_samples);
            }

            // Build list of audio sources to process
            let mut audio_sources: Vec<(Vec<f32>, u32, usize, AudioSource)> = Vec::new();

            // Add mic samples if available (with AEC applied)
            if !mic_samples.is_empty() {
                let rate = recording_state_clone.sample_rate.load(Ordering::SeqCst);
                let ch = recording_state_clone.channels.load(Ordering::SeqCst) as usize;
                if rate > 0 && ch > 0 {
                    // Convert mic to mono first if needed
                    let mono_mic: Vec<f32> = if ch > 1 {
                        mic_samples
                            .chunks(ch)
                            .map(|chunk| chunk.iter().sum::<f32>() / ch as f32)
                            .collect()
                    } else {
                        mic_samples
                    };

                    // Resample mic to 16kHz for AEC processing
                    let mic_16k = if rate != 16000 {
                        resample(&mono_mic, rate, 16000)
                    } else {
                        mono_mic
                    };

                    // Apply AEC to remove speaker echo from mic
                    let reference = get_reference_samples(mic_16k.len());
                    let cleaned_mic = if !reference.is_empty() {
                        aec::apply_aec(&mic_16k, &reference)
                    } else {
                        mic_16k
                    };

                    // Mic samples are now cleaned (16kHz mono)
                    audio_sources.push((cleaned_mic, 16000_u32, 1_usize, AudioSource::Mic));
                }
            }

            // Add system audio samples if available (already at 16kHz mono)
            if !system_samples.is_empty() {
                audio_sources.push((system_samples, 16000_u32, 1_usize, AudioSource::System));
            }

            // Process each audio source
            for (samples, sample_rate, channels, audio_source) in audio_sources {
                let whisper_ctx = whisper_ctx_clone.clone();
                let time_offset = match audio_source {
                    AudioSource::Mic => *live_state_clone.mic_time_offset.lock().await,
                    AudioSource::System => *live_state_clone.system_time_offset.lock().await,
                };

                let result = tokio::task::spawn_blocking(move || {
                    transcribe_samples(&whisper_ctx, &samples, sample_rate, channels, time_offset)
                })
                .await;

                match result {
                    Ok(Ok(transcription)) => {
                        if !transcription.segments.is_empty() {
                            // Update time offset for next chunk
                            if let Some(last) = transcription.segments.last() {
                                match audio_source {
                                    AudioSource::Mic => {
                                        *live_state_clone.mic_time_offset.lock().await = last.end_time;
                                    }
                                    AudioSource::System => {
                                        *live_state_clone.system_time_offset.lock().await = last.end_time;
                                    }
                                }
                            }

                            // Filter out blank/noise segments
                            let valid_segments: Vec<_> = transcription
                                .segments
                                .into_iter()
                                .filter(|s| !should_skip_segment(&s.text))
                                .collect();

                            if !valid_segments.is_empty() {
                                // Determine speaker based on audio source
                                let speaker = match audio_source {
                                    AudioSource::Mic => Some("You"),
                                    AudioSource::System => Some("Others"),
                                };

                                // Save segments to database with speaker
                                let db = app_clone.state::<Database>();
                                for segment in &valid_segments {
                                    if let Err(e) = db.add_transcript_segment(
                                        &meeting_id_clone,
                                        segment.start_time,
                                        segment.end_time,
                                        &segment.text,
                                        speaker,
                                    ) {
                                        eprintln!("Failed to save transcript segment: {}", e);
                                    }
                                }

                                // Store segments in memory (for final result)
                                live_state_clone
                                    .segments
                                    .lock()
                                    .await
                                    .extend(valid_segments.clone());

                                // Emit event with audio source
                                let event = TranscriptionUpdateEvent {
                                    meeting_id: meeting_id_clone.clone(),
                                    segments: valid_segments,
                                    is_final: false,
                                    audio_source,
                                };

                                let _ = app_clone.emit("transcription-update", event);
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        eprintln!("Live transcription error ({:?}): {}", audio_source, e);
                    }
                    Err(e) => {
                        eprintln!("Live transcription task error ({:?}): {}", audio_source, e);
                    }
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
