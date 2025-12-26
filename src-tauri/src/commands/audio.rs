use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::audio::{self, is_system_audio_available, mix_wav_files, RecordingState, SystemAudioCapture};

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
