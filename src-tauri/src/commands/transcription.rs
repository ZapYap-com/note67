use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

use crate::db::Database;
use crate::transcription::{ModelInfo, ModelManager, ModelSize, TranscriptionResult, Transcriber};

/// State for transcription operations
pub struct TranscriptionState {
    pub model_manager: Mutex<Option<ModelManager>>,
    pub transcriber: Mutex<Option<Arc<Transcriber>>>,
    pub current_model: Mutex<Option<ModelSize>>,
    pub is_transcribing: AtomicBool,
    pub download_progress: Arc<AtomicU8>,
    pub is_downloading: AtomicBool,
}

impl Default for TranscriptionState {
    fn default() -> Self {
        Self {
            model_manager: Mutex::new(None),
            transcriber: Mutex::new(None),
            current_model: Mutex::new(None),
            is_transcribing: AtomicBool::new(false),
            download_progress: Arc::new(AtomicU8::new(0)),
            is_downloading: AtomicBool::new(false),
        }
    }
}

/// Initialize transcription state with app data directory
pub fn init_transcription_state(app: &AppHandle) -> TranscriptionState {
    let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    let model_manager = ModelManager::new(app_data_dir);

    TranscriptionState {
        model_manager: Mutex::new(Some(model_manager)),
        transcriber: Mutex::new(None),
        current_model: Mutex::new(None),
        is_transcribing: AtomicBool::new(false),
        download_progress: Arc::new(AtomicU8::new(0)),
        is_downloading: AtomicBool::new(false),
    }
}

/// List available models and their download status
#[tauri::command]
pub fn list_models(state: State<TranscriptionState>) -> Result<Vec<ModelInfo>, String> {
    let manager = state.model_manager.lock().map_err(|e| e.to_string())?;
    let manager = manager.as_ref().ok_or("Model manager not initialized")?;
    Ok(manager.list_models())
}

/// Download a model
#[tauri::command]
pub async fn download_model(
    size: String,
    state: State<'_, TranscriptionState>,
) -> Result<String, String> {
    let model_size = parse_model_size(&size)?;

    // Check if already downloading
    if state.is_downloading.swap(true, Ordering::SeqCst) {
        return Err("Already downloading a model".to_string());
    }

    // Reset progress
    state.download_progress.store(0, Ordering::SeqCst);

    // Get the model manager
    let manager = {
        let guard = state.model_manager.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Model manager not initialized")?.clone()
    };

    // Create progress callback
    let progress = state.download_progress.clone();
    let on_progress = move |downloaded: u64, total: u64| {
        if total > 0 {
            let pct = ((downloaded as f64 / total as f64) * 100.0) as u8;
            progress.store(pct, Ordering::SeqCst);
        }
    };

    // Perform download
    let result = manager.download_model(model_size, on_progress).await;

    // Reset downloading flag
    state.is_downloading.store(false, Ordering::SeqCst);

    match result {
        Ok(path) => Ok(path.to_string_lossy().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Get current download progress (0-100)
#[tauri::command]
pub fn get_download_progress(state: State<TranscriptionState>) -> u8 {
    state.download_progress.load(Ordering::SeqCst)
}

/// Check if currently downloading
#[tauri::command]
pub fn is_downloading(state: State<TranscriptionState>) -> bool {
    state.is_downloading.load(Ordering::SeqCst)
}

/// Delete a downloaded model
#[tauri::command]
pub async fn delete_model(
    size: String,
    state: State<'_, TranscriptionState>,
) -> Result<(), String> {
    let model_size = parse_model_size(&size)?;

    // Check if this model is currently loaded
    {
        let current = state.current_model.lock().map_err(|e| e.to_string())?;
        if current.as_ref() == Some(&model_size) {
            // Unload the transcriber
            let mut transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
            *transcriber = None;
            drop(transcriber);

            let mut current = state.current_model.lock().map_err(|e| e.to_string())?;
            *current = None;
        }
    }

    let manager = {
        let guard = state.model_manager.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Model manager not initialized")?.clone()
    };

    manager.delete_model(model_size).await.map_err(|e| e.to_string())
}

/// Load a model for transcription
#[tauri::command]
pub fn load_model(size: String, state: State<TranscriptionState>) -> Result<(), String> {
    let model_size = parse_model_size(&size)?;

    // Check if already loaded
    {
        let current = state.current_model.lock().map_err(|e| e.to_string())?;
        if current.as_ref() == Some(&model_size) {
            return Ok(()); // Already loaded
        }
    }

    // Get model path
    let model_path = {
        let manager = state.model_manager.lock().map_err(|e| e.to_string())?;
        let manager = manager.as_ref().ok_or("Model manager not initialized")?;
        manager.model_path(model_size)
    };

    if !model_path.exists() {
        return Err(format!("Model {} is not downloaded", size));
    }

    // Load the model
    let transcriber = Transcriber::new(&model_path).map_err(|e| e.to_string())?;

    // Store the transcriber
    {
        let mut t = state.transcriber.lock().map_err(|e| e.to_string())?;
        *t = Some(Arc::new(transcriber));
    }

    // Update current model
    {
        let mut current = state.current_model.lock().map_err(|e| e.to_string())?;
        *current = Some(model_size);
    }

    Ok(())
}

/// Get the currently loaded model
#[tauri::command]
pub fn get_loaded_model(state: State<TranscriptionState>) -> Option<String> {
    let current = state.current_model.lock().ok()?;
    current.as_ref().map(|m| m.as_str().to_string())
}

/// Transcribe an audio file
#[tauri::command]
pub async fn transcribe_audio(
    audio_path: String,
    meeting_id: String,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<TranscriptionResult, String> {
    // Check if already transcribing
    if state.is_transcribing.swap(true, Ordering::SeqCst) {
        return Err("Already transcribing".to_string());
    }

    // Get the transcriber
    let transcriber = {
        let guard = state.transcriber.lock().map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;
        guard.clone().ok_or_else(|| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            "No model loaded. Please load a model first.".to_string()
        })?
    };

    // Run transcription in a blocking task (since whisper-rs is synchronous)
    let path = PathBuf::from(&audio_path);
    let result = tokio::task::spawn_blocking(move || transcriber.transcribe(&path))
        .await
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;

    // Save segments to database
    for segment in &result.segments {
        db.add_transcript_segment(&meeting_id, segment.start_time, segment.end_time, &segment.text, None)
            .map_err(|e| e.to_string())?;
    }

    state.is_transcribing.store(false, Ordering::SeqCst);
    Ok(result)
}

/// Check if currently transcribing
#[tauri::command]
pub fn is_transcribing(state: State<TranscriptionState>) -> bool {
    state.is_transcribing.load(Ordering::SeqCst)
}

/// Get transcript segments for a meeting
#[tauri::command]
pub fn get_transcript(
    meeting_id: String,
    db: State<Database>,
) -> Result<Vec<crate::db::models::TranscriptSegment>, String> {
    db.get_transcript_segments(&meeting_id).map_err(|e| e.to_string())
}

fn parse_model_size(size: &str) -> Result<ModelSize, String> {
    match size.to_lowercase().as_str() {
        "tiny" => Ok(ModelSize::Tiny),
        "base" => Ok(ModelSize::Base),
        "small" => Ok(ModelSize::Small),
        "medium" => Ok(ModelSize::Medium),
        "large" => Ok(ModelSize::Large),
        _ => Err(format!("Invalid model size: {}", size)),
    }
}
