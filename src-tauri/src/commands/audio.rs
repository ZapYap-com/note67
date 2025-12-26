use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::audio::{self, RecordingState};

pub struct AudioState {
    pub recording: Arc<RecordingState>,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            recording: Arc::new(RecordingState::new()),
        }
    }
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<AudioState>,
    meeting_id: String,
) -> Result<String, String> {
    // Get app data directory for storing recordings
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.wav", meeting_id);
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
