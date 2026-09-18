use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::audio::{
    self, build_playback_track, is_system_audio_available, RecordingPhase, RecordingState,
    SystemAudioCapture,
};
use crate::db::Database;

/// Result of dual recording containing paths to all recorded files
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualRecordingResult {
    /// Path to the mic recording (None for listen-only / system-audio-only sessions)
    pub mic_path: Option<String>,
    /// Path to the system audio recording (only on supported platforms with permission)
    pub system_path: Option<String>,
    /// Path to the merged playback file (created after recording stops)
    pub playback_path: Option<String>,
}

pub struct AudioState {
    pub recording: Arc<RecordingState>,
    /// System audio capture instance (macOS only)
    pub system_capture: Mutex<Option<Arc<dyn SystemAudioCapture>>>,
    /// Path to the system audio recording file
    pub system_output_path: Mutex<Option<PathBuf>>,
}

impl Default for AudioState {
    fn default() -> Self {
        // Try to create system audio capture if supported
        let system_capture = crate::audio::create_system_audio_capture().ok();

        Self {
            recording: Arc::new(RecordingState::new()),
            system_capture: Mutex::new(system_capture),
            system_output_path: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<AudioState>,
    note_id: String,
) -> Result<String, String> {
    ensure_no_session(&state.recording)?;

    // Get app data directory for storing recordings
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.wav", note_id);
    let output_path = recordings_dir.join(&filename);

    audio::start_recording(state.recording.clone(), output_path.clone())
        .map_err(|e| e.to_string())?;

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn stop_recording(state: State<AudioState>) -> Result<Option<String>, String> {
    let path = audio::stop_recording(&state.recording).map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn get_recording_status(state: State<AudioState>) -> bool {
    state.recording.is_recording.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn get_audio_level(state: State<AudioState>) -> f32 {
    f32::from_bits(state.recording.audio_level.load(Ordering::SeqCst))
}

/// Check if system audio capture is available on this platform
#[tauri::command]
pub fn is_system_audio_supported() -> bool {
    is_system_audio_available()
}

/// Check if the app has permission to capture system audio
#[tauri::command]
pub fn has_system_audio_permission(state: State<AudioState>) -> Result<bool, String> {
    let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

    match capture.as_ref() {
        Some(cap) => cap.has_permission().map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

/// Request permission to capture system audio
/// On macOS, this will trigger the system permission dialog if needed
#[tauri::command]
pub fn request_system_audio_permission(state: State<AudioState>) -> Result<bool, String> {
    let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

    match capture.as_ref() {
        Some(cap) => cap.request_permission().map_err(|e| e.to_string()),
        None => Err("System audio capture not supported on this platform".to_string()),
    }
}

// ========== Microphone Permission Commands ==========

/// Check if a microphone is available on this device
#[tauri::command]
pub fn has_microphone_available() -> bool {
    use cpal::traits::HostTrait;

    let host = cpal::default_host();

    // Check if there's a default input device
    if host.default_input_device().is_some() {
        return true;
    }

    // If no default, check if there are any input devices at all
    if let Ok(devices) = host.input_devices() {
        return devices.count() > 0;
    }

    false
}

/// Check if the app has microphone permission (macOS)
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn has_microphone_permission() -> bool {
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    unsafe {
        // AVAuthorizationStatus values:
        // 0 = NotDetermined, 1 = Restricted, 2 = Denied, 3 = Authorized
        let cls = class!(AVCaptureDevice);
        let media_type = NSString::from_str("soun"); // AVMediaTypeAudio = "soun"
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: &*media_type];
        status == 3 // Authorized
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn has_microphone_permission() -> bool {
    // On non-macOS platforms, assume permission is granted if mic is available
    has_microphone_available()
}

/// Get microphone authorization status (macOS)
/// Returns: 0 = NotDetermined, 1 = Restricted, 2 = Denied, 3 = Authorized
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_microphone_auth_status() -> i64 {
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    unsafe {
        let cls = class!(AVCaptureDevice);
        let media_type = NSString::from_str("soun"); // AVMediaTypeAudio
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: &*media_type];
        status
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn get_microphone_auth_status() -> i64 {
    // Return "Authorized" on non-macOS if mic is available
    if has_microphone_available() { 3 } else { 2 }
}

/// Request microphone permission (macOS)
/// This triggers the system permission dialog and makes the app appear in System Settings
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn request_microphone_permission() -> bool {
    use objc2::{class, msg_send};
    use objc2::runtime::Bool;
    use objc2_foundation::NSString;

    unsafe {
        let cls = class!(AVCaptureDevice);
        let media_type = NSString::from_str("soun"); // AVMediaTypeAudio

        // Create a block for the completion handler
        // We use a no-op block since we'll have the user refresh the status
        let block = block2::RcBlock::new(|_granted: Bool| {
            // Permission dialog shown, user will refresh to check status
        });

        // Request access - this triggers the permission dialog
        let _: () = msg_send![cls, requestAccessForMediaType: &*media_type, completionHandler: &*block];
    }

    // Return current status after triggering the dialog
    // User should refresh to get the final result
    has_microphone_permission()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn request_microphone_permission() -> bool {
    // On non-macOS platforms, just check if mic is available
    has_microphone_available()
}

/// Start dual recording (mic + system audio)
/// Returns paths to both recording files
#[tauri::command]
pub fn start_dual_recording(
    app: AppHandle,
    state: State<AudioState>,
    note_id: String,
) -> Result<DualRecordingResult, String> {
    // Get app data directory for storing recordings
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    // Mic recording path
    let mic_filename = format!("{}_mic.wav", note_id);
    let mic_path = recordings_dir.join(&mic_filename);

    // System audio recording path
    let system_filename = format!("{}_system.wav", note_id);
    let system_path = recordings_dir.join(&system_filename);

    // Start mic recording
    audio::start_recording(state.recording.clone(), mic_path.clone())
        .map_err(|e| e.to_string())?;

    // Try to start system audio recording if available
    let system_started = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

        if let Some(cap) = capture.as_ref() {
            match cap.start(system_path.clone()) {
                Ok(()) => {
                    // Store the system output path
                    let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
                    *sys_path = Some(system_path.clone());
                    true
                }
                Err(e) => {
                    eprintln!("Failed to start system audio capture: {}", e);
                    false
                }
            }
        } else {
            false
        }
    };

    Ok(DualRecordingResult {
        mic_path: Some(mic_path.to_string_lossy().to_string()),
        system_path: if system_started {
            Some(system_path.to_string_lossy().to_string())
        } else {
            None
        },
        playback_path: None, // Will be set when recording stops
    })
}

/// Stop dual recording and merge files for playback
/// Returns the result with all paths including the merged playback file
#[tauri::command]
pub fn stop_dual_recording(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
) -> Result<DualRecordingResult, String> {
    // Stop mic recording
    let mic_path = audio::stop_recording(&state.recording)
        .map_err(|e| e.to_string())?
        .ok_or("No mic recording path found")?;

    // Stop system audio recording
    let system_path = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

        if let Some(cap) = capture.as_ref() {
            cap.stop().map_err(|e| e.to_string())?
        } else {
            None
        }
    };

    // Clear stored system path
    {
        let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
        *sys_path = None;
    }

    // Same whole-note rebuild as the segment-aware stop below. Routing both
    // through one builder is deliberate: this path used to merge only the file
    // it had just closed, which is exactly how playback lost earlier segments.
    let playback_path = build_note_playback(&app, &db, &note_id);

    Ok(DualRecordingResult {
        mic_path: Some(mic_path.to_string_lossy().to_string()),
        system_path: system_path.map(|p| p.to_string_lossy().to_string()),
        playback_path,
    })
}

/// Stop dual recording with segment tracking - updates segment duration in database
#[tauri::command]
pub fn stop_dual_recording_with_segments(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
) -> Result<DualRecordingResult, String> {
    // Read the open segment before stop_recording resets the session: it
    // zeroes current_segment_db_id, so reading the id afterwards meant the
    // final segment's duration was never saved.
    let open_segment = open_segment_timing(&state.recording);

    // Stop mic recording
    let mic_path = audio::stop_recording(&state.recording)
        .map_err(|e| e.to_string())?
        .ok_or("No mic recording path found")?;

    // Stop system audio recording
    let system_path = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

        if let Some(cap) = capture.as_ref() {
            cap.stop().map_err(|e| e.to_string())?
        } else {
            None
        }
    };

    // Clear stored system path
    {
        let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
        *sys_path = None;
    }

    if let Some((segment_id, duration_ms)) = open_segment {
        let _ = db.update_segment_duration(segment_id, duration_ms);
    }

    // Rebuild playback from every segment in the note, not just the one that
    // just stopped — otherwise continuing a recording throws away the audio of
    // everything before it.
    let playback_path = build_note_playback(&app, &db, &note_id);

    Ok(DualRecordingResult {
        mic_path: Some(mic_path.to_string_lossy().to_string()),
        system_path: system_path.map(|p| p.to_string_lossy().to_string()),
        playback_path,
    })
}

/// Rebuild `{note_id}_playback.wav` from all of the note's recording segments,
/// in order.
///
/// The track used to be `{note_id}.wav`, which is also the name of a legacy
/// mic-only recording, and such a recording becomes segment 0 of its note: so
/// continuing that note, or rebuilding it, replaced the recording with the
/// mix. The combined track now has a name no recording uses.
///
/// Returns `None` (having logged) if it cannot be built — playback is a
/// convenience, and the per-segment files are still on disk either way, so a
/// failure here must not fail the stop that produced them.
fn build_note_playback(app: &AppHandle, db: &Database, note_id: &str) -> Option<String> {
    let recordings_dir = match app.path().app_data_dir() {
        Ok(dir) => dir.join("recordings"),
        Err(e) => {
            eprintln!("Playback: no app data dir: {}", e);
            return None;
        }
    };

    let segments = match db.get_audio_segments(note_id) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Playback: could not read audio segments: {}", e);
            return None;
        }
    };

    // get_audio_segments already returns display order; keep it.
    let inputs: Vec<(PathBuf, Option<PathBuf>)> = segments
        .iter()
        .filter_map(|seg| {
            seg.mic_path
                .as_ref()
                .map(|mic| (PathBuf::from(mic), seg.system_path.as_ref().map(PathBuf::from)))
        })
        .collect();

    if inputs.is_empty() {
        return None;
    }

    let playback_file = recordings_dir.join(format!("{}_playback.wav", note_id));
    match build_playback_track(&inputs, &playback_file) {
        Ok(()) => Some(playback_file.to_string_lossy().to_string()),
        Err(e) => {
            eprintln!("Playback: failed to build track from {} segment(s): {}", inputs.len(), e);
            None
        }
    }
}

/// Duration of a WAV in seconds, from its header alone.
fn wav_duration_secs(path: &PathBuf) -> Option<f64> {
    let reader = hound::WavReader::open(path).ok()?;
    let rate = reader.spec().sample_rate;
    if rate == 0 {
        return None;
    }
    Some(reader.duration() as f64 / rate as f64)
}

/// Whether a note's combined playback track is missing audio.
///
/// Playback is only rewritten when a recording stops, so notes recorded before
/// playback learned to span every segment still hold a file containing just the
/// last one. Compares the track against the segments it should cover rather
/// than tracking a schema version — the files are the truth, and this stays
/// correct if a segment is ever removed or re-recorded.
#[tauri::command]
pub fn playback_needs_rebuild(
    db: State<Database>,
    note_id: String,
) -> Result<bool, String> {
    let segments = db.get_audio_segments(&note_id).map_err(|e| e.to_string())?;

    // A single segment cannot be truncated, and with none there is nothing to
    // rebuild from.
    if segments.len() < 2 {
        return Ok(false);
    }

    let expected: f64 = segments
        .iter()
        .filter_map(|seg| seg.mic_path.as_ref().or(seg.system_path.as_ref()))
        .map(PathBuf::from)
        .filter_map(|p| wav_duration_secs(&p))
        .sum();

    // Source files gone — nothing to rebuild from, so do not offer it.
    if expected <= 0.0 {
        return Ok(false);
    }

    // Measure the track the note actually plays. It has had two names, so the
    // note's audio_path, not a guessed filename, is the one that counts.
    let current = db
        .get_note_audio_path(&note_id)
        .map_err(|e| e.to_string())?
        .map(PathBuf::from)
        .and_then(|p| wav_duration_secs(&p))
        .unwrap_or(0.0);

    // Tolerance for resampling and rounding across segment boundaries.
    Ok(current < expected * 0.95)
}

/// Rebuild a note's combined playback track from its segments.
///
/// Only regenerates the derived {note_id}_playback.wav and points the note at
/// it; transcripts, notes and the per-segment audio are untouched, so it is
/// safe to run repeatedly.
#[tauri::command]
pub fn rebuild_note_playback(
    app: AppHandle,
    db: State<Database>,
    note_id: String,
) -> Result<String, String> {
    let path = build_note_playback(&app, &db, &note_id)
        .ok_or_else(|| "Could not rebuild playback from this note's recordings".to_string())?;
    db.set_note_audio_path(&note_id, &path)
        .map_err(|e| e.to_string())?;
    Ok(path)
}

/// Path to a single recording segment's audio, mixed for playback.
///
/// The list of recordings plays each segment on its own. Handing back the raw
/// mic file made a quiet microphone sound like nothing at all, and it dropped
/// the other side of the conversation entirely — a segment should play back the
/// same way it appears in the full track.
///
/// Built on demand and cached beside the source files: only segments the user
/// actually plays cost anything, and the mix is reused afterwards. Falls back to
/// whichever raw file exists if the mix cannot be built, since playing something
/// beats playing nothing.
#[tauri::command]
pub fn get_segment_playback_path(
    app: AppHandle,
    db: State<Database>,
    segment_id: i64,
) -> Result<String, String> {
    let segment = db
        .get_audio_segment(segment_id)
        .map_err(|e| e.to_string())?
        .ok_or("Segment not found")?;

    let mic = segment.mic_path.as_ref().map(PathBuf::from);
    let system = segment.system_path.as_ref().map(PathBuf::from);

    // Listen-only segments have no mic side; there is nothing to mix.
    let Some(mic) = mic.filter(|p| p.exists()) else {
        return system
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "Segment has no readable audio".to_string());
    };

    let raw_fallback = mic.to_string_lossy().to_string();

    let Some(system) = system.filter(|p| p.exists()) else {
        // Mic only — the raw file already is the mix.
        return Ok(raw_fallback);
    };

    let recordings_dir = match app.path().app_data_dir() {
        Ok(dir) => dir.join("recordings"),
        Err(_) => return Ok(raw_fallback),
    };
    let mixed = recordings_dir.join(format!(
        "{}_seg{}_mix.wav",
        segment.note_id, segment.segment_index
    ));

    // Reuse an existing mix unless a source has changed since (retranscription
    // and continued recordings can rewrite a segment's audio).
    let is_fresh = |mixed: &PathBuf| -> bool {
        let mixed_time = std::fs::metadata(mixed).and_then(|m| m.modified()).ok();
        let newest_source = [&mic, &system]
            .iter()
            .filter_map(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
            .max();
        match (mixed_time, newest_source) {
            (Some(m), Some(s)) => m >= s,
            _ => false,
        }
    };

    if mixed.exists() && is_fresh(&mixed) {
        return Ok(mixed.to_string_lossy().to_string());
    }

    match build_playback_track(&[(mic, Some(system))], &mixed) {
        Ok(()) => Ok(mixed.to_string_lossy().to_string()),
        Err(e) => {
            eprintln!("Failed to build segment playback mix: {}", e);
            Ok(raw_fallback)
        }
    }
}

/// Check if dual recording is currently active
#[tauri::command]
pub fn is_dual_recording(state: State<AudioState>) -> bool {
    let mic_recording = state.recording.is_recording.load(Ordering::SeqCst);

    let system_recording = state
        .system_capture
        .lock()
        .ok()
        .and_then(|cap| cap.as_ref().map(|c| c.is_capturing()))
        .unwrap_or(false);

    mic_recording || system_recording
}

// ========== Pause/Resume/Continue Recording Commands ==========

/// Get the current recording phase
#[tauri::command]
pub fn get_recording_phase(state: State<AudioState>) -> u8 {
    state.recording.get_phase() as u8
}

/// Pause the current recording (mic only)
/// Returns the duration of the paused segment in milliseconds
#[tauri::command]
pub fn pause_recording_cmd(state: State<AudioState>) -> Result<i64, String> {
    audio::pause_recording(&state.recording).map_err(|e| e.to_string())
}

/// Resume a paused recording (mic only)
#[tauri::command]
pub fn resume_recording_cmd(
    app: AppHandle,
    state: State<AudioState>,
    note_id: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    // Get the next segment index
    let segment_index = state.recording.current_segment_index.load(Ordering::SeqCst);

    let filename = format!("{}_seg{}.wav", note_id, segment_index);
    let output_path = recordings_dir.join(&filename);

    audio::resume_recording(state.recording.clone(), output_path.clone())
        .map_err(|e| e.to_string())?;

    Ok(output_path.to_string_lossy().to_string())
}

/// Pause dual recording (mic + system audio)
/// Returns the duration of the paused segment in milliseconds
#[tauri::command]
pub fn pause_dual_recording(
    state: State<AudioState>,
    db: State<Database>,
) -> Result<i64, String> {
    // Pause mic recording first
    let duration_ms = audio::pause_recording(&state.recording).map_err(|e| e.to_string())?;

    // Stop system audio capture
    {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;
        if let Some(cap) = capture.as_ref() {
            let _ = cap.stop();
        }
    }

    // Update the segment duration in the database
    let segment_id = state.recording.current_segment_db_id.load(Ordering::SeqCst);
    if segment_id > 0 {
        let _ = db.update_segment_duration(segment_id, duration_ms);
    }

    Ok(duration_ms)
}

/// Resume dual recording after pause
/// Returns paths to the new segment files
#[tauri::command]
pub fn resume_dual_recording(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
    capture_system: Option<bool>,
) -> Result<DualRecordingResult, String> {
    let current_phase = state.recording.get_phase();
    if current_phase != RecordingPhase::Paused {
        return Err("Recording is not paused".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    // Get the next segment index from database
    let segment_index = db
        .get_next_segment_index(&note_id)
        .map_err(|e| e.to_string())?;

    // Calculate start offset from previous segments
    let start_offset_ms = db
        .get_total_segment_duration(&note_id)
        .map_err(|e| e.to_string())?;

    // Update state with new segment info
    state
        .recording
        .current_segment_index
        .store(segment_index as u32, Ordering::SeqCst);
    state
        .recording
        .segment_start_offset_ms
        .store(start_offset_ms, Ordering::SeqCst);

    // Mic recording path with segment index
    let mic_filename = format!("{}_mic_seg{}.wav", note_id, segment_index);
    let mic_path = recordings_dir.join(&mic_filename);

    // System audio recording path with segment index
    let system_filename = format!("{}_system_seg{}.wav", note_id, segment_index);
    let system_path = recordings_dir.join(&system_filename);

    // Add segment to database
    let segment_id = db
        .add_audio_segment(
            &note_id,
            segment_index,
            Some(mic_path.to_string_lossy().as_ref()),
            Some(system_path.to_string_lossy().as_ref()),
            start_offset_ms,
        )
        .map_err(|e| e.to_string())?;

    // Store segment ID for later duration update
    state
        .recording
        .current_segment_db_id
        .store(segment_id, Ordering::SeqCst);

    // Start mic recording
    audio::resume_recording(state.recording.clone(), mic_path.clone())
        .map_err(|e| e.to_string())?;

    let system_started = start_segment_system_capture(
        &state,
        &db,
        segment_id,
        &system_path,
        capture_system.unwrap_or(true),
    )?;

    Ok(DualRecordingResult {
        mic_path: Some(mic_path.to_string_lossy().to_string()),
        system_path: if system_started {
            Some(system_path.to_string_lossy().to_string())
        } else {
            None
        },
        playback_path: None,
    })
}

/// Continue recording on an ended note
/// Reopens the note and starts a new recording segment
#[tauri::command]
pub fn continue_note_recording(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
    capture_system: Option<bool>,
) -> Result<DualRecordingResult, String> {
    ensure_no_session(&state.recording)?;

    // First, reopen the note (clear ended_at)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now();

        // Check if note exists
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM notes WHERE id = ?1)",
                [&note_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if !exists {
            return Err("Note not found".to_string());
        }

        // Clear ended_at to reopen the note
        conn.execute(
            "UPDATE notes SET ended_at = NULL, updated_at = ?1 WHERE id = ?2",
            (now.to_rfc3339(), &note_id),
        )
        .map_err(|e| e.to_string())?;
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    // Store note ID in state
    {
        let mut current_note = state
            .recording
            .current_note_id
            .lock()
            .map_err(|e| e.to_string())?;
        *current_note = Some(note_id.clone());
    }

    // Get the next segment index from database
    let segment_index = db
        .get_next_segment_index(&note_id)
        .map_err(|e| e.to_string())?;

    // Calculate start offset from previous segments
    let start_offset_ms = db
        .get_total_segment_duration(&note_id)
        .map_err(|e| e.to_string())?;

    // Update state with segment info
    state
        .recording
        .current_segment_index
        .store(segment_index as u32, Ordering::SeqCst);
    state
        .recording
        .segment_start_offset_ms
        .store(start_offset_ms, Ordering::SeqCst);

    // Mic recording path with segment index
    let mic_filename = format!("{}_mic_seg{}.wav", note_id, segment_index);
    let mic_path = recordings_dir.join(&mic_filename);

    // System audio recording path with segment index
    let system_filename = format!("{}_system_seg{}.wav", note_id, segment_index);
    let system_path = recordings_dir.join(&system_filename);

    // Add segment to database
    let segment_id = db
        .add_audio_segment(
            &note_id,
            segment_index,
            Some(mic_path.to_string_lossy().as_ref()),
            Some(system_path.to_string_lossy().as_ref()),
            start_offset_ms,
        )
        .map_err(|e| e.to_string())?;

    // Store segment ID for later duration update
    state
        .recording
        .current_segment_db_id
        .store(segment_id, Ordering::SeqCst);

    // Start mic recording
    audio::start_recording(state.recording.clone(), mic_path.clone())
        .map_err(|e| e.to_string())?;

    let system_started = start_segment_system_capture(
        &state,
        &db,
        segment_id,
        &system_path,
        capture_system.unwrap_or(true),
    )?;

    Ok(DualRecordingResult {
        mic_path: Some(mic_path.to_string_lossy().to_string()),
        system_path: if system_started {
            Some(system_path.to_string_lossy().to_string())
        } else {
            None
        },
        playback_path: None,
    })
}

/// Start dual recording with segment tracking
/// This is an enhanced version of start_dual_recording that tracks segments in the database
#[tauri::command]
pub fn start_dual_recording_with_segments(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
    capture_system: Option<bool>,
) -> Result<DualRecordingResult, String> {
    ensure_no_session(&state.recording)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    // Reset state for new recording session
    state.recording.reset_for_new_session();

    // Store note ID
    {
        let mut current_note = state
            .recording
            .current_note_id
            .lock()
            .map_err(|e| e.to_string())?;
        *current_note = Some(note_id.clone());
    }

    // Get segment index (should be 0 for new recording)
    let segment_index = db
        .get_next_segment_index(&note_id)
        .map_err(|e| e.to_string())?;

    // Mic recording path with segment index
    let mic_filename = format!("{}_mic_seg{}.wav", note_id, segment_index);
    let mic_path = recordings_dir.join(&mic_filename);

    // System audio recording path with segment index
    let system_filename = format!("{}_system_seg{}.wav", note_id, segment_index);
    let system_path = recordings_dir.join(&system_filename);

    // Add segment to database (start_offset_ms is 0 for first segment)
    let segment_id = db
        .add_audio_segment(
            &note_id,
            segment_index,
            Some(mic_path.to_string_lossy().as_ref()),
            Some(system_path.to_string_lossy().as_ref()),
            0, // First segment starts at 0
        )
        .map_err(|e| e.to_string())?;

    // Store segment ID for later duration update
    state
        .recording
        .current_segment_db_id
        .store(segment_id, Ordering::SeqCst);

    // Start mic recording
    audio::start_recording(state.recording.clone(), mic_path.clone())
        .map_err(|e| e.to_string())?;

    let system_started = start_segment_system_capture(
        &state,
        &db,
        segment_id,
        &system_path,
        capture_system.unwrap_or(true),
    )?;

    Ok(DualRecordingResult {
        mic_path: Some(mic_path.to_string_lossy().to_string()),
        system_path: if system_started {
            Some(system_path.to_string_lossy().to_string())
        } else {
            None
        },
        playback_path: None,
    })
}

// ========== System-audio-only ("listen-only") recording ==========
// Used when the microphone is unavailable or denied but system audio is supported.
// The user is just listening into a meeting; only system audio is captured.

/// Refuse to start while a session is recording or paused.
///
/// Every start path resets the session and writes a segment row for its note
/// before the recorder itself notices it is busy. Starting over a running (or
/// paused) session therefore re-pointed that session at the new note: its
/// audio and its Stop were filed under the wrong note, and the real one was
/// never ended. So check first, before any state or database write.
fn ensure_no_session(state: &RecordingState) -> Result<(), String> {
    match state.get_phase() {
        RecordingPhase::Idle => Ok(()),
        _ => Err("A recording is already in progress. Stop it before starting another.".to_string()),
    }
}

/// Start system-audio capture for a segment whose row already names
/// `system_path`, unless `wanted` is false (a mic-only session).
///
/// When capture doesn't start, the row's system_path is cleared. Rows used to
/// keep the path of a file that was never written, and retranscription and
/// playback then looked for it.
fn start_segment_system_capture(
    state: &AudioState,
    db: &Database,
    segment_id: i64,
    system_path: &std::path::Path,
    wanted: bool,
) -> Result<bool, String> {
    let started = wanted && {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;
        match capture.as_ref() {
            Some(cap) => match cap.start(system_path.to_path_buf()) {
                Ok(()) => {
                    let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
                    *sys_path = Some(system_path.to_path_buf());
                    true
                }
                Err(e) => {
                    eprintln!("Failed to start system audio capture: {}", e);
                    false
                }
            },
            None => false,
        }
    };
    if !started {
        let _ = db.clear_segment_system_path(segment_id);
    }
    Ok(started)
}

/// The segment a stop should close: its database id and how long it ran.
///
/// None when no segment is running. A paused segment already had its duration
/// saved by the pause, and the elapsed clock keeps counting through a pause,
/// so timing it again at stop would overwrite a correct duration with one that
/// includes the paused time.
fn open_segment_timing(state: &RecordingState) -> Option<(i64, i64)> {
    if state.get_phase() != RecordingPhase::Recording {
        return None;
    }
    let segment_id = state.current_segment_db_id.load(Ordering::SeqCst);
    (segment_id > 0).then(|| (segment_id, state.get_segment_elapsed_ms()))
}

fn set_phase_for_system_only_session(state: &RecordingState) {
    use std::time::Instant;
    state.set_phase(RecordingPhase::Recording);
    if let Ok(mut start_time) = state.segment_start_time.lock() {
        *start_time = Some(Instant::now());
    }
}

#[tauri::command]
pub fn start_system_only_recording_with_segments(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
) -> Result<DualRecordingResult, String> {
    ensure_no_session(&state.recording)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    state.recording.reset_for_new_session();

    {
        let mut current_note = state
            .recording
            .current_note_id
            .lock()
            .map_err(|e| e.to_string())?;
        *current_note = Some(note_id.clone());
    }

    let segment_index = db
        .get_next_segment_index(&note_id)
        .map_err(|e| e.to_string())?;

    let system_filename = format!("{}_system_seg{}.wav", note_id, segment_index);
    let system_path = recordings_dir.join(&system_filename);

    let segment_id = db
        .add_audio_segment(
            &note_id,
            segment_index,
            None,
            Some(system_path.to_string_lossy().as_ref()),
            0,
        )
        .map_err(|e| e.to_string())?;

    state
        .recording
        .current_segment_db_id
        .store(segment_id, Ordering::SeqCst);

    // Start system audio capture. Errors here are fatal — without mic or system audio,
    // there's nothing to record.
    {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;
        let cap = capture
            .as_ref()
            .ok_or_else(|| "System audio capture not available".to_string())?;
        cap.start(system_path.clone()).map_err(|e| e.to_string())?;
    }
    {
        let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
        *sys_path = Some(system_path.clone());
    }

    set_phase_for_system_only_session(&state.recording);

    Ok(DualRecordingResult {
        mic_path: None,
        system_path: Some(system_path.to_string_lossy().to_string()),
        playback_path: None,
    })
}

#[tauri::command]
pub fn stop_system_only_recording_with_segments(
    state: State<AudioState>,
    db: State<Database>,
    _note_id: String,
) -> Result<DualRecordingResult, String> {
    let open_segment = open_segment_timing(&state.recording);

    let system_path = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;
        if let Some(cap) = capture.as_ref() {
            cap.stop().map_err(|e| e.to_string())?
        } else {
            None
        }
    };

    {
        let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
        *sys_path = None;
    }

    if let Some((segment_id, duration_ms)) = open_segment {
        let _ = db.update_segment_duration(segment_id, duration_ms);
    }

    state.recording.set_phase(RecordingPhase::Idle);
    state.recording.reset_for_new_session();

    let system_path_str = system_path.as_ref().map(|p| p.to_string_lossy().to_string());

    Ok(DualRecordingResult {
        mic_path: None,
        // Listen-only has only one stream, so playback == system file.
        playback_path: system_path_str.clone(),
        system_path: system_path_str,
    })
}

#[tauri::command]
pub fn pause_system_only_recording(
    state: State<AudioState>,
    db: State<Database>,
) -> Result<i64, String> {
    if state.recording.get_phase() != RecordingPhase::Recording {
        return Err("Recording is not active".to_string());
    }
    let duration_ms = state.recording.get_segment_elapsed_ms();

    {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;
        if let Some(cap) = capture.as_ref() {
            let _ = cap.stop();
        }
    }

    state.recording.set_phase(RecordingPhase::Paused);

    let segment_id = state.recording.current_segment_db_id.load(Ordering::SeqCst);
    if segment_id > 0 {
        let _ = db.update_segment_duration(segment_id, duration_ms);
    }

    Ok(duration_ms)
}

#[tauri::command]
pub fn resume_system_only_recording(
    app: AppHandle,
    state: State<AudioState>,
    db: State<Database>,
    note_id: String,
) -> Result<DualRecordingResult, String> {
    if state.recording.get_phase() != RecordingPhase::Paused {
        return Err("Recording is not paused".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    let segment_index = db
        .get_next_segment_index(&note_id)
        .map_err(|e| e.to_string())?;
    let start_offset_ms = db
        .get_total_segment_duration(&note_id)
        .map_err(|e| e.to_string())?;

    state
        .recording
        .current_segment_index
        .store(segment_index as u32, Ordering::SeqCst);
    state
        .recording
        .segment_start_offset_ms
        .store(start_offset_ms, Ordering::SeqCst);

    let system_filename = format!("{}_system_seg{}.wav", note_id, segment_index);
    let system_path = recordings_dir.join(&system_filename);

    let segment_id = db
        .add_audio_segment(
            &note_id,
            segment_index,
            None,
            Some(system_path.to_string_lossy().as_ref()),
            start_offset_ms,
        )
        .map_err(|e| e.to_string())?;

    state
        .recording
        .current_segment_db_id
        .store(segment_id, Ordering::SeqCst);

    {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;
        let cap = capture
            .as_ref()
            .ok_or_else(|| "System audio capture not available".to_string())?;
        cap.start(system_path.clone()).map_err(|e| e.to_string())?;
    }
    {
        let mut sys_path = state.system_output_path.lock().map_err(|e| e.to_string())?;
        *sys_path = Some(system_path.clone());
    }

    set_phase_for_system_only_session(&state.recording);

    Ok(DualRecordingResult {
        mic_path: None,
        system_path: Some(system_path.to_string_lossy().to_string()),
        playback_path: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn running_segment(id: i64, started: Duration) -> RecordingState {
        let state = RecordingState::new();
        state.set_phase(RecordingPhase::Recording);
        state.current_segment_db_id.store(id, Ordering::SeqCst);
        *state.segment_start_time.lock().unwrap() = Some(Instant::now() - started);
        state
    }

    #[test]
    fn a_running_segment_is_timed_at_stop() {
        let state = running_segment(7, Duration::from_secs(90));
        let (id, ms) = open_segment_timing(&state).expect("a running segment");
        assert_eq!(id, 7);
        assert!((90_000..95_000).contains(&ms), "timed {ms} ms");
    }

    #[test]
    fn a_paused_segment_keeps_the_duration_its_pause_saved() {
        let state = running_segment(7, Duration::from_secs(600));
        state.set_phase(RecordingPhase::Paused);
        assert_eq!(open_segment_timing(&state), None);
    }

    #[test]
    fn a_new_session_is_refused_while_one_is_recording_or_paused() {
        let state = RecordingState::new();
        assert!(ensure_no_session(&state).is_ok());

        state.set_phase(RecordingPhase::Recording);
        assert!(ensure_no_session(&state).is_err());

        // Paused is still an open session: a start from here used to begin a
        // new session for another note and leave the paused one never ended.
        state.set_phase(RecordingPhase::Paused);
        assert!(ensure_no_session(&state).is_err());

        state.set_phase(RecordingPhase::Idle);
        assert!(ensure_no_session(&state).is_ok());
    }

    #[test]
    fn nothing_is_timed_after_the_session_resets() {
        let state = running_segment(7, Duration::from_secs(5));
        state.reset_for_new_session();
        assert_eq!(open_segment_timing(&state), None);
    }
}
