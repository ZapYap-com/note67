use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::audio::{
    self, aec, is_system_audio_available, mix_wav_files, RecordingPhase, RecordingState,
    SystemAudioCapture,
};
use crate::db::Database;

/// Result of dual recording containing paths to all recorded files
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualRecordingResult {
    /// Path to the mic recording (always present)
    pub mic_path: String,
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
        mic_path: mic_path.to_string_lossy().to_string(),
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

    // Merge files if we have both
    let playback_path = if let Some(ref sys_path) = system_path {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        let recordings_dir = app_data_dir.join("recordings");
        let playback_filename = format!("{}.wav", note_id);
        let playback_file = recordings_dir.join(&playback_filename);

        // Merge the two files
        match mix_wav_files(&mic_path, sys_path, &playback_file) {
            Ok(()) => Some(playback_file.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("Failed to merge audio files: {}", e);
                // Fall back to mic path as playback
                None
            }
        }
    } else {
        None
    };

    Ok(DualRecordingResult {
        mic_path: mic_path.to_string_lossy().to_string(),
        system_path: system_path.map(|p| p.to_string_lossy().to_string()),
        playback_path,
    })
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

/// Check if AEC (Acoustic Echo Cancellation) is enabled
#[tauri::command]
pub fn is_aec_enabled() -> bool {
    aec::is_aec_enabled()
}

/// Set AEC enabled state
/// Disable AEC when using headphones for better performance
#[tauri::command]
pub fn set_aec_enabled(enabled: bool) {
    aec::set_aec_enabled(enabled);
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
            mic_path.to_string_lossy().as_ref(),
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

    // Try to start system audio recording
    let system_started = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

        if let Some(cap) = capture.as_ref() {
            match cap.start(system_path.clone()) {
                Ok(()) => {
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
        mic_path: mic_path.to_string_lossy().to_string(),
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
) -> Result<DualRecordingResult, String> {
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
            mic_path.to_string_lossy().as_ref(),
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

    // Try to start system audio recording
    let system_started = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

        if let Some(cap) = capture.as_ref() {
            match cap.start(system_path.clone()) {
                Ok(()) => {
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
        mic_path: mic_path.to_string_lossy().to_string(),
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
) -> Result<DualRecordingResult, String> {
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
            mic_path.to_string_lossy().as_ref(),
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

    // Try to start system audio recording
    let system_started = {
        let capture = state.system_capture.lock().map_err(|e| e.to_string())?;

        if let Some(cap) = capture.as_ref() {
            match cap.start(system_path.clone()) {
                Ok(()) => {
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
        mic_path: mic_path.to_string_lossy().to_string(),
        system_path: if system_started {
            Some(system_path.to_string_lossy().to_string())
        } else {
            None
        },
        playback_path: None,
    })
}
