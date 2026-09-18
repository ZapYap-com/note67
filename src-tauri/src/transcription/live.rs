use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::interval;

use crate::audio::{take_system_audio_samples, RecordingPhase, RecordingState};
use crate::db::models::NewTranscriptSegment;
use crate::db::Database;
use crate::transcription::{
    is_echo_of_system, should_skip_live_segment, should_skip_segment, TranscriptionError,
    TranscriptionResult, TranscriptionSegment,
};
use tauri::Manager;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

/// Simple voice activity detection based on RMS energy
/// Returns true if audio has enough energy to likely contain speech
fn has_voice_activity(samples: &[f32], threshold: f32) -> bool {
    rms(samples) > threshold
}

/// RMS energy of a chunk. 0.0 for an empty chunk.
fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Peak the mic chunk aims for after normalization.
const MIC_TARGET_PEAK: f32 = 0.3;
/// Ceiling on the normalization gain. This is the safety property: it stops
/// near-silence being amplified up to speech level, so the voice-activity gate
/// downstream still separates the two.
///
/// Chosen from a real quiet-mic recording: speech windows needed only 2.9–5.1x
/// to reach the target, so the cap never binds on speech, while the noise floor
/// would have needed 25–46x and is clamped here. That leaves speech landing at
/// RMS 0.026–0.033 and noise at most 0.012, with the 0.02 gate between them.
const MIC_MAX_GAIN: f32 = 8.0;

/// Scale `samples` up toward `target_peak`, never by more than `max_gain`.
///
/// Whisper (and the RMS gate) expect roughly line-level audio. Some mics sit
/// tens of dB below full scale, which made both behave as if nothing was said.
/// Only ever amplifies — already-loud audio is left alone.
fn normalize_peak(samples: &mut [f32], target_peak: f32, max_gain: f32) {
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    if peak <= f32::EPSILON {
        return;
    }
    let gain = (target_peak / peak).clamp(1.0, max_gain);
    if gain > 1.0 {
        for s in samples.iter_mut() {
            *s *= gain;
        }
    }
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

            // Check if still recording. Use the phase rather than is_recording, because
            // listen-only (system-audio-only) sessions never set is_recording — that flag
            // is owned by the mic recording thread.
            if recording_state_clone.get_phase() != RecordingPhase::Recording {
                break;
            }

            // Get audio buffers - both mic and system audio
            let mic_samples = recording_state_clone.take_audio_buffer();
            let system_samples = take_system_audio_samples();

            // Track how much audio (in seconds) each stream actually consumed this
            // pass, so the time offsets advance by real elapsed audio rather than by
            // the last transcribed segment's end time (which drifts behind whenever
            // there is trailing silence or VAD-skipped audio). System audio is
            // already 16kHz mono.
            let system_consumed_secs = system_samples.len() as f64 / 16000.0;
            let mut mic_consumed_secs = 0.0_f64;

            // Build list of audio sources to process
            let mut audio_sources: Vec<(Vec<f32>, u32, usize, AudioSource)> = Vec::new();

            // Add mic samples if available and has voice activity
            if !mic_samples.is_empty() {
                let rate = recording_state_clone.sample_rate.load(Ordering::SeqCst);
                let ch = recording_state_clone.channels.load(Ordering::SeqCst) as usize;
                if rate > 0 && ch > 0 {
                    // Duration of mic audio consumed this pass (counts silence too,
                    // so the timeline still advances when VAD skips this buffer).
                    mic_consumed_secs = (mic_samples.len() as f64 / ch as f64) / rate as f64;

                    // Convert mic to mono first if needed
                    let mut mono_mic: Vec<f32> = if ch > 1 {
                        mic_samples
                            .chunks(ch)
                            .map(|chunk| chunk.iter().sum::<f32>() / ch as f32)
                            .collect()
                    } else {
                        mic_samples
                    };

                    // Lift the chunk toward a usable level BEFORE the gate.
                    //
                    // The gate used to run on raw samples against a fixed RMS,
                    // which assumed a hot mic. A quiet one (measured here ~30dB
                    // low: loudest 3s window RMS 0.009 against a 0.02 threshold)
                    // never passed, so the mic was silently never transcribed
                    // while system audio — which has no gate — always was.
                    //
                    // Normalizing first makes the threshold independent of the
                    // mic's input gain, and the gain cap is what preserves the
                    // silence/speech distinction: near-silence cannot be
                    // amplified far enough to clear the gate.
                    normalize_peak(&mut mono_mic, MIC_TARGET_PEAK, MIC_MAX_GAIN);

                    // Only process if there's voice activity (RMS > 0.02 of the
                    // normalized signal). Also gives Whisper audio at a level it
                    // can actually work with.
                    if has_voice_activity(&mono_mic, 0.02) {
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
            let mut db_segments: Vec<NewTranscriptSegment> = Vec::new();
            let mut all_events: Vec<TranscriptionUpdateEvent> = Vec::new();

            // Process system results FIRST and update rolling history for echo detection
            let mut current_system_segments: Vec<TranscriptionSegment> = Vec::new();

            if let Some(transcription) = &system_result
                && !transcription.segments.is_empty()
            {
                // Note the asymmetry with the mic path below, which uses the
                // lenient filter: system audio has no voice-activity gate ahead
                // of it, so the silence-hallucination list is still earning its
                // place here.
                let valid: Vec<_> = transcription
                    .segments
                    .iter()
                    .filter(|s| !should_skip_segment(&s.text, s.start_time, s.end_time))
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

            // Get current rolling history for echo check
            let system_segments_for_echo_check: Vec<(f64, f64, String)> =
                live_state_clone.recent_system_segments.lock().await.clone();

            // Process mic results with echo filtering
            if let Some(transcription) = mic_result
                && !transcription.segments.is_empty()
            {
                // Filter out blank segments and echoes of the system audio.
                let valid_segments: Vec<_> = transcription
                    .segments
                    .into_iter()
                    .filter(|s| !should_skip_live_segment(&s.text, s.start_time, s.end_time))
                    .filter(|s| !is_echo_of_system(&s.text, s.start_time, s.end_time, &system_segments_for_echo_check))
                    .collect();

                if !valid_segments.is_empty() {
                    for segment in &valid_segments {
                        db_segments.push(
                            NewTranscriptSegment::new(
                                note_id_clone.clone(),
                                segment.start_time,
                                segment.end_time,
                                segment.text.clone(),
                            )
                            .with_speaker(Some("You".to_string()))
                            .with_source_type("live"),
                        );
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

            // Now add system results to state and events (using already-filtered current_system_segments)
            if !current_system_segments.is_empty() {
                for segment in &current_system_segments {
                    db_segments.push(
                        NewTranscriptSegment::new(
                            note_id_clone.clone(),
                            segment.start_time,
                            segment.end_time,
                            segment.text.clone(),
                        )
                        .with_speaker(Some("Others".to_string()))
                        .with_source_type("live"),
                    );
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

            // Advance per-stream time offsets by the audio actually consumed this
            // pass so live timestamps track real elapsed time (staying aligned with
            // the post-recording retranscription) instead of drifting behind when a
            // pass had trailing silence or was skipped by VAD.
            if mic_consumed_secs > 0.0 {
                *live_state_clone.mic_time_offset.lock().await += mic_consumed_secs;
            }
            if system_consumed_secs > 0.0 {
                *live_state_clone.system_time_offset.lock().await += system_consumed_secs;
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

#[cfg(test)]
mod tests {
    use super::{has_voice_activity, normalize_peak, MIC_MAX_GAIN, MIC_TARGET_PEAK};

    /// Build a chunk with an explicit peak and RMS.
    ///
    /// Speech has a high crest factor — the real quiet-mic recording measured
    /// peak 0.081 against RMS 0.009, a ratio of ~9:1 — so a plain sine (ratio
    /// 1.41:1) is not a usable stand-in for these thresholds.
    fn chunk(peak: f32, rms: f32, len: usize) -> Vec<f32> {
        let duty = (rms / peak).powi(2);
        let loud = (((len as f32) * duty).round() as usize).clamp(1, len);
        let mut v = vec![0.0f32; len];
        for (i, s) in v.iter_mut().enumerate().take(loud) {
            *s = if i % 2 == 0 { peak } else { -peak };
        }
        v
    }

    #[test]
    fn chunk_helper_hits_the_requested_peak_and_rms() {
        let c = chunk(0.08, 0.009, 48_000);
        let peak = c.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        let rms = (c.iter().map(|x| x * x).sum::<f32>() / c.len() as f32).sqrt();
        assert!((peak - 0.08).abs() < 1e-6, "peak was {peak}");
        assert!((rms - 0.009).abs() < 5e-4, "rms was {rms}");
    }

    #[test]
    fn normalize_lifts_quiet_audio_toward_the_target() {
        let mut s = chunk(0.08, 0.009, 48_000);
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        let peak = s.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak > 0.25, "expected lift toward target, got peak {peak}");
    }

    #[test]
    fn normalize_never_attenuates_loud_audio() {
        let mut s = chunk(0.9, 0.2, 1000);
        let before = s.clone();
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        assert_eq!(s, before, "already-loud audio must be left alone");
    }

    #[test]
    fn normalize_respects_the_gain_cap() {
        let mut s = chunk(0.006, 0.001, 48_000);
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        let peak = s.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak <= 0.006 * MIC_MAX_GAIN + 1e-6, "gain exceeded the cap");
    }

    #[test]
    fn normalize_handles_all_zero_input() {
        let mut s = vec![0.0f32; 100];
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        assert!(s.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn quiet_speech_passes_the_gate_after_normalization() {
        // The reported bug, using the measured levels: a quiet mic's speech
        // (peak 0.081, RMS 0.009) failed the 0.02 gate outright, so the mic was
        // never transcribed while system audio — which has no gate — always was.
        let mut s = chunk(0.081, 0.00896, 48_000);
        assert!(
            !has_voice_activity(&s, 0.02),
            "precondition: raw quiet speech fails the gate"
        );
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        assert!(
            has_voice_activity(&s, 0.02),
            "quiet speech must pass the gate once normalized"
        );
    }

    #[test]
    fn background_noise_still_fails_the_gate_after_normalization() {
        // The other half: the gain cap must keep the noise floor from the same
        // recording (worst case peak 0.0118, RMS 0.00148) below the gate.
        let mut s = chunk(0.0118, 0.00148, 48_000);
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        assert!(
            !has_voice_activity(&s, 0.02),
            "near-silence must not be amplified into apparent speech"
        );
    }

    #[test]
    fn loud_mic_is_unaffected_by_normalization() {
        // A normal-level mic already clears the gate and must not be touched.
        let mut s = chunk(0.5, 0.06, 48_000);
        assert!(has_voice_activity(&s, 0.02));
        let before = s.clone();
        normalize_peak(&mut s, MIC_TARGET_PEAK, MIC_MAX_GAIN);
        assert_eq!(s, before);
    }
}
