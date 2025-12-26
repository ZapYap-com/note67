use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_rs::{WhisperContext, WhisperContextParameters};

use crate::commands::audio::AudioState;
use crate::db::Database;
use crate::transcription::{
    live, LiveTranscriptionState, ModelInfo, ModelManager, ModelSize, TranscriptionResult,
    Transcriber,
};

/// State for transcription operations
pub struct TranscriptionState {
    pub model_manager: Mutex<Option<ModelManager>>,
    pub transcriber: Mutex<Option<Arc<Transcriber>>>,
    pub whisper_ctx: Mutex<Option<Arc<WhisperContext>>>,
    pub current_model: Mutex<Option<ModelSize>>,
    pub is_transcribing: AtomicBool,
    pub download_progress: Arc<AtomicU8>,
    pub is_downloading: AtomicBool,
    pub live_state: Arc<LiveTranscriptionState>,
}

impl Default for TranscriptionState {
    fn default() -> Self {
        Self {
            model_manager: Mutex::new(None),
            transcriber: Mutex::new(None),
            whisper_ctx: Mutex::new(None),
            current_model: Mutex::new(None),
            is_transcribing: AtomicBool::new(false),
            download_progress: Arc::new(AtomicU8::new(0)),
            is_downloading: AtomicBool::new(false),
            live_state: Arc::new(LiveTranscriptionState::new()),
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
        whisper_ctx: Mutex::new(None),
        current_model: Mutex::new(None),
        is_transcribing: AtomicBool::new(false),
        download_progress: Arc::new(AtomicU8::new(0)),
        is_downloading: AtomicBool::new(false),
        live_state: Arc::new(LiveTranscriptionState::new()),
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

    // Also load WhisperContext for live transcription
    let whisper_ctx = WhisperContext::new_with_params(
        model_path.to_str().unwrap(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load whisper context: {}", e))?;

    // Store the transcriber
    {
        let mut t = state.transcriber.lock().map_err(|e| e.to_string())?;
        *t = Some(Arc::new(transcriber));
    }

    // Store the whisper context
    {
        let mut ctx = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
        *ctx = Some(Arc::new(whisper_ctx));
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
    speaker: Option<String>,
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
        db.add_transcript_segment(&meeting_id, segment.start_time, segment.end_time, &segment.text, speaker.as_deref())
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

/// Result of dual transcription
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualTranscriptionResult {
    /// Transcription result from mic audio ("You")
    pub mic_result: TranscriptionResult,
    /// Transcription result from system audio ("Others"), if available
    pub system_result: Option<TranscriptionResult>,
    /// Total number of segments saved
    pub total_segments: usize,
}

/// Transcribe dual audio files (mic and system) with speaker labels
///
/// - mic_path: Path to the microphone recording (labeled as "You")
/// - system_path: Optional path to system audio recording (labeled as "Others")
/// - meeting_id: The meeting ID to associate segments with
#[tauri::command]
pub async fn transcribe_dual_audio(
    mic_path: String,
    system_path: Option<String>,
    meeting_id: String,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<DualTranscriptionResult, String> {
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

    let mut total_segments = 0;

    // Transcribe mic audio (labeled as "You")
    let mic_path_buf = PathBuf::from(&mic_path);
    let transcriber_clone = transcriber.clone();
    let mic_result = tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&mic_path_buf))
        .await
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;

    // Save mic segments to database with "You" speaker label
    for segment in &mic_result.segments {
        db.add_transcript_segment(
            &meeting_id,
            segment.start_time,
            segment.end_time,
            &segment.text,
            Some("You"),
        )
        .map_err(|e| e.to_string())?;
        total_segments += 1;
    }

    // Transcribe system audio if provided (labeled as "Others")
    let system_result = if let Some(sys_path) = system_path {
        let sys_path_buf = PathBuf::from(&sys_path);
        let transcriber_clone = transcriber.clone();

        match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&sys_path_buf)).await {
            Ok(Ok(result)) => {
                // Save system segments to database with "Others" speaker label
                for segment in &result.segments {
                    db.add_transcript_segment(
                        &meeting_id,
                        segment.start_time,
                        segment.end_time,
                        &segment.text,
                        Some("Others"),
                    )
                    .map_err(|e| e.to_string())?;
                    total_segments += 1;
                }
                Some(result)
            }
            Ok(Err(e)) => {
                eprintln!("Failed to transcribe system audio: {}", e);
                None
            }
            Err(e) => {
                eprintln!("Failed to spawn system audio transcription task: {}", e);
                None
            }
        }
    } else {
        None
    };

    state.is_transcribing.store(false, Ordering::SeqCst);

    Ok(DualTranscriptionResult {
        mic_result,
        system_result,
        total_segments,
    })
}

/// Get transcript segments for a meeting
#[tauri::command]
pub fn get_transcript(
    meeting_id: String,
    db: State<Database>,
) -> Result<Vec<crate::db::models::TranscriptSegment>, String> {
    db.get_transcript_segments(&meeting_id).map_err(|e| e.to_string())
}

/// Add a transcript segment directly (for seeding/testing)
#[tauri::command]
pub fn add_transcript_segment(
    meeting_id: String,
    start_time: f64,
    end_time: f64,
    text: String,
    speaker: Option<String>,
    db: State<Database>,
) -> Result<i64, String> {
    db.add_transcript_segment(&meeting_id, start_time, end_time, &text, speaker.as_deref())
        .map_err(|e| e.to_string())
}

/// Start live transcription during recording
#[tauri::command]
pub async fn start_live_transcription(
    app: AppHandle,
    meeting_id: String,
    state: State<'_, TranscriptionState>,
    audio_state: State<'_, AudioState>,
) -> Result<(), String> {
    // Get the whisper context
    let whisper_ctx = {
        let guard = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
        guard.clone().ok_or("No model loaded. Please load a model first.")?
    };

    let recording_state = audio_state.recording.clone();
    let live_state = state.live_state.clone();

    live::start_live_transcription(app, meeting_id, recording_state, live_state, whisper_ctx)
        .await
        .map_err(|e| e.to_string())
}

/// Stop live transcription and get final result
#[tauri::command]
pub async fn stop_live_transcription(
    app: AppHandle,
    meeting_id: String,
    state: State<'_, TranscriptionState>,
) -> Result<TranscriptionResult, String> {
    let live_state = state.live_state.clone();
    let result = live::stop_live_transcription(live_state).await;

    // Segments are already saved to database during live transcription with speaker labels

    // Emit final event (with empty segments - they were already sent in periodic updates)
    let event = crate::transcription::TranscriptionUpdateEvent {
        meeting_id,
        segments: vec![],
        is_final: true,
        audio_source: crate::transcription::AudioSource::Mic, // Default for final event
    };
    let _ = app.emit("transcription-update", event);

    Ok(result)
}

/// Check if live transcription is running
#[tauri::command]
pub fn is_live_transcribing(state: State<TranscriptionState>) -> bool {
    state.live_state.is_running.load(Ordering::SeqCst)
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
