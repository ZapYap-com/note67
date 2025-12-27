use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::interval;

use crate::audio::{take_system_audio_samples, RecordingState};
use crate::db::Database;
use crate::transcription::{TranscriptionError, TranscriptionResult, TranscriptionSegment};
use tauri::Manager;
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

/// Simple voice activity detection based on RMS energy
/// Returns true if audio has enough energy to likely contain speech
fn has_voice_activity(samples: &[f32], threshold: f32) -> bool {
    if samples.is_empty() {
        return false;
    }
    // Calculate RMS energy
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (sum_sq / samples.len() as f32).sqrt();
    rms > threshold
}

/// Fast check if a mic segment is likely an echo of system audio
/// Uses simple first-words comparison for speed
fn is_echo_of_system(
    mic_text: &str,
    mic_start: f64,
    mic_end: f64,
    system_segments: &[(f64, f64, String)], // (start, end, text)
) -> bool {
    // Quick early exit
    if system_segments.is_empty() {
        return false;
    }

    let mic_lower = mic_text.to_lowercase();
    let mic_words: Vec<&str> = mic_lower.split_whitespace().take(5).collect();
    if mic_words.is_empty() {
        return false;
    }

    for (sys_start, sys_end, sys_text) in system_segments {
        // Quick time overlap check (must overlap by at least 1 second)
        let overlap_start = mic_start.max(*sys_start);
        let overlap_end = mic_end.min(*sys_end);
        if overlap_end - overlap_start < 1.0 {
            continue;
        }

        // Fast text check: compare first 3-5 words
        let sys_lower = sys_text.to_lowercase();
        let sys_words: Vec<&str> = sys_lower.split_whitespace().take(5).collect();

        // Count matching words in first 5
        let matches = mic_words.iter()
            .filter(|w| sys_words.contains(w))
            .count();

        // If 3+ words match out of first 5, it's likely echo
        if matches >= 3 || (matches >= 2 && mic_words.len() <= 3) {
            return true;
        }
    }
    false
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
    /// Recent system audio segments for echo detection (rolling history)
    pub recent_system_segments: Mutex<Vec<(f64, f64, String)>>,
}

impl LiveTranscriptionState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            mic_time_offset: Mutex::new(0.0),
            system_time_offset: Mutex::new(0.0),
            segments: Mutex::new(Vec::new()),
            recent_system_segments: Mutex::new(Vec::new()),
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
    pub note_id: String,
    pub segments: Vec<TranscriptionSegment>,
    pub is_final: bool,
    /// The source of the audio (mic or system)
    pub audio_source: AudioSource,
}

/// Start live transcription
/// Runs every 3 seconds, transcribes accumulated audio in parallel, saves to DB, emits events
pub async fn start_live_transcription(
    app: AppHandle,
    note_id: String,
    language: Option<String>,
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
    live_state.recent_system_segments.lock().await.clear();

    let app_clone = app.clone();
    let note_id_clone = note_id.clone();
    let language_clone = language.clone();
    let recording_state_clone = recording_state.clone();
    let live_state_clone = live_state.clone();
    let whisper_ctx_clone = whisper_ctx.clone();

    // Spawn the live transcription task
    tokio::spawn(async move {
        let lang = language_clone;
        let mut ticker = interval(Duration::from_secs(3));

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

            // Build list of audio sources to process
            let mut audio_sources: Vec<(Vec<f32>, u32, usize, AudioSource)> = Vec::new();

            // Add mic samples if available and has voice activity
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

                    // Only process if there's voice activity (RMS > 0.01)
                    // This filters out silence and low background noise
                    if has_voice_activity(&mono_mic, 0.01) {
                        // Resample mic to 16kHz for Whisper
                        let mic_16k = if rate != 16000 {
                            resample(&mono_mic, rate, 16000)
                        } else {
                            mono_mic
                        };

                        audio_sources.push((mic_16k, 16000_u32, 1_usize, AudioSource::Mic));
                    }
                }
            }

            // Extract mic audio data if available
            let mic_data = if let Some((samples, _, _, _)) = audio_sources
                .iter()
                .find(|(_, _, _, src)| *src == AudioSource::Mic)
            {
                let offset = *live_state_clone.mic_time_offset.lock().await;
                Some((samples.clone(), offset))
            } else {
                None
            };

            // Extract system audio data if available
            let system_data = if !system_samples.is_empty() {
                let offset = *live_state_clone.system_time_offset.lock().await;
                Some((system_samples, offset))
            } else {
                None
            };

            // Process mic and system audio in PARALLEL
            let whisper_ctx_mic = whisper_ctx_clone.clone();
            let whisper_ctx_sys = whisper_ctx_clone.clone();

            let lang_mic = lang.clone();
            let lang_sys = lang.clone();

            let mic_future = async {
                if let Some((samples, time_offset)) = mic_data {
                    let ctx = whisper_ctx_mic;
                    let language = lang_mic;
                    tokio::task::spawn_blocking(move || {
                        transcribe_samples(&ctx, &samples, 16000, 1, time_offset, language.as_deref())
                    })
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                } else {
                    None
                }
            };

            let system_future = async {
                if let Some((samples, time_offset)) = system_data {
                    let ctx = whisper_ctx_sys;
                    let language = lang_sys;
                    tokio::task::spawn_blocking(move || {
                        transcribe_samples(&ctx, &samples, 16000, 1, time_offset, language.as_deref())
                    })
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                } else {
                    None
                }
            };

            // Run both transcriptions in parallel
            let (mic_result, system_result) = tokio::join!(mic_future, system_future);

            // Collect all segments for batch DB insert
            let mut db_segments: Vec<(String, f64, f64, String, Option<String>)> = Vec::new();
            let mut all_events: Vec<TranscriptionUpdateEvent> = Vec::new();

            // Process system results FIRST and update rolling history for echo detection
            let mut current_system_segments: Vec<TranscriptionSegment> = Vec::new();

            if let Some(transcription) = &system_result {
                if !transcription.segments.is_empty() {
                    let valid: Vec<_> = transcription
                        .segments
                        .iter()
                        .filter(|s| !should_skip_segment(&s.text))
                        .cloned()
                        .collect();

                    // Add new segments to rolling history
                    {
                        let mut history = live_state_clone.recent_system_segments.lock().await;
                        for seg in &valid {
                            history.push((seg.start_time, seg.end_time, seg.text.clone()));
                        }
                        // Keep only last 30 seconds of system segments (based on end_time)
                        let current_time = *live_state_clone.system_time_offset.lock().await;
                        let cutoff = current_time - 30.0;
                        history.retain(|(_, end, _)| *end > cutoff);
                    }
                    current_system_segments = valid;
                }
            }

            // Get current rolling history for echo check
            let system_segments_for_echo_check: Vec<(f64, f64, String)> =
                live_state_clone.recent_system_segments.lock().await.clone();

            // Process mic results with echo filtering
            if let Some(transcription) = mic_result {
                if !transcription.segments.is_empty() {
                    if let Some(last) = transcription.segments.last() {
                        *live_state_clone.mic_time_offset.lock().await = last.end_time;
                    }

                    // Filter out blank segments AND echo duplicates
                    let valid_segments: Vec<_> = transcription
                        .segments
                        .into_iter()
                        .filter(|s| !should_skip_segment(&s.text))
                        .filter(|s| !is_echo_of_system(&s.text, s.start_time, s.end_time, &system_segments_for_echo_check))
                        .collect();

                    if !valid_segments.is_empty() {
                        for segment in &valid_segments {
                            db_segments.push((
                                note_id_clone.clone(),
                                segment.start_time,
                                segment.end_time,
                                segment.text.clone(),
                                Some("You".to_string()),
                            ));
                        }

                        live_state_clone
                            .segments
                            .lock()
                            .await
                            .extend(valid_segments.clone());

                        all_events.push(TranscriptionUpdateEvent {
                            note_id: note_id_clone.clone(),
                            segments: valid_segments,
                            is_final: false,
                            audio_source: AudioSource::Mic,
                        });
                    }
                }
            }

            // Now add system results to state and events (using already-filtered current_system_segments)
            if !current_system_segments.is_empty() {
                if let Some(last) = current_system_segments.last() {
                    *live_state_clone.system_time_offset.lock().await = last.end_time;
                }

                for segment in &current_system_segments {
                    db_segments.push((
                        note_id_clone.clone(),
                        segment.start_time,
                        segment.end_time,
                        segment.text.clone(),
                        Some("Others".to_string()),
                    ));
                }

                live_state_clone
                    .segments
                    .lock()
                    .await
                    .extend(current_system_segments.clone());

                all_events.push(TranscriptionUpdateEvent {
                    note_id: note_id_clone.clone(),
                    segments: current_system_segments,
                    is_final: false,
                    audio_source: AudioSource::System,
                });
            }

            // Batch insert all segments into database
            if !db_segments.is_empty() {
                let db = app_clone.state::<Database>();
                if let Err(e) = db.add_transcript_segments_batch(&db_segments) {
                    eprintln!("Failed to batch save transcript segments: {}", e);
                }
            }

            // Emit all events
            for event in all_events {
                let _ = app_clone.emit("transcription-update", event);
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
    language: Option<&str>,
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
    params.set_language(language); // None = auto-detect
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
        language: language.map(|s| s.to_string()),
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
