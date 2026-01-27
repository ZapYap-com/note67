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

/// Check if a transcript segment should be skipped (blank audio, inaudible, etc.)
fn should_skip_segment(text: &str) -> bool {
    let text_lower = text.to_lowercase();
    text_lower.contains("[blank_audio]")
        || text_lower.contains("[inaudible]")
        || text_lower.contains("[ inaudible ]")
        || text_lower.contains("[silence]")
        || text_lower.contains("[music]")
        || text_lower.contains("[applause]")
        || text_lower.contains("[laughter]")
        || text.trim().is_empty()
}

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
    note_id: String,
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

    // Save segments to database (skip blank/noise segments)
    for segment in &result.segments {
        if !should_skip_segment(&segment.text) {
            db.add_transcript_segment(&note_id, segment.start_time, segment.end_time, &segment.text, speaker.as_deref(), None, None)
                .map_err(|e| e.to_string())?;
        }
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
/// - note_id: The note ID to associate segments with
#[tauri::command]
pub async fn transcribe_dual_audio(
    mic_path: String,
    system_path: Option<String>,
    note_id: String,
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

    // Save mic segments to database with "You" speaker label (skip blank/noise)
    for segment in &mic_result.segments {
        if !should_skip_segment(&segment.text) {
            db.add_transcript_segment(
                &note_id,
                segment.start_time,
                segment.end_time,
                &segment.text,
                Some("You"),
                None,
                None,
            )
            .map_err(|e| e.to_string())?;
            total_segments += 1;
        }
    }

    // Transcribe system audio if provided (labeled as "Others")
    let system_result = if let Some(sys_path) = system_path {
        let sys_path_buf = PathBuf::from(&sys_path);
        let transcriber_clone = transcriber.clone();

        match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&sys_path_buf)).await {
            Ok(Ok(result)) => {
                // Save system segments to database with "Others" speaker label (skip blank/noise)
                for segment in &result.segments {
                    if !should_skip_segment(&segment.text) {
                        db.add_transcript_segment(
                            &note_id,
                            segment.start_time,
                            segment.end_time,
                            &segment.text,
                            Some("Others"),
                            None,
                            None,
                        )
                        .map_err(|e| e.to_string())?;
                        total_segments += 1;
                    }
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

/// Get transcript segments for a note
#[tauri::command]
pub fn get_transcript(
    note_id: String,
    db: State<Database>,
) -> Result<Vec<crate::db::models::TranscriptSegment>, String> {
    db.get_transcript_segments(&note_id).map_err(|e| e.to_string())
}

/// Add a transcript segment directly (for seeding/testing)
#[tauri::command]
pub fn add_transcript_segment(
    note_id: String,
    start_time: f64,
    end_time: f64,
    text: String,
    speaker: Option<String>,
    source_type: Option<String>,
    source_id: Option<i64>,
    db: State<Database>,
) -> Result<i64, String> {
    db.add_transcript_segment(&note_id, start_time, end_time, &text, speaker.as_deref(), source_type.as_deref(), source_id)
        .map_err(|e| e.to_string())
}

/// Start live transcription during recording
#[tauri::command]
pub async fn start_live_transcription(
    app: AppHandle,
    note_id: String,
    language: Option<String>,
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

    live::start_live_transcription(app, note_id, language, recording_state, live_state, whisper_ctx)
        .await
        .map_err(|e| e.to_string())
}

/// Stop live transcription and get final result
#[tauri::command]
pub async fn stop_live_transcription(
    app: AppHandle,
    note_id: String,
    state: State<'_, TranscriptionState>,
) -> Result<TranscriptionResult, String> {
    let live_state = state.live_state.clone();
    let result = live::stop_live_transcription(live_state).await;

    // Segments are already saved to database during live transcription with speaker labels

    // Emit final event (with empty segments - they were already sent in periodic updates)
    let event = crate::transcription::TranscriptionUpdateEvent {
        note_id,
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

/// Result of retranscribing an entire note
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetranscribeResult {
    pub total_items: usize,
    pub completed_items: usize,
    pub failed_items: Vec<String>,
    pub total_segments: usize,
}

/// Retranscribe an audio segment (recorded segment)
#[tauri::command]
pub async fn retranscribe_audio_segment(
    segment_id: i64,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<usize, String> {
    // Get the segment info
    let segment = db
        .get_audio_segment_by_id(segment_id)
        .map_err(|e| e.to_string())?;

    // Check if already transcribing
    if state.is_transcribing.swap(true, Ordering::SeqCst) {
        return Err("Already transcribing. Please wait for the current transcription to finish.".to_string());
    }

    // Delete existing transcript segments for this segment
    db.delete_transcript_segments_by_source("segment", segment_id)
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;

    // Get the transcriber
    let transcriber = {
        let guard = state.transcriber.lock().map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;
        guard.clone().ok_or_else(|| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            "No model loaded. Please load a Whisper model first.".to_string()
        })?
    };

    let mut total_segments = 0;

    // Transcribe mic audio (labeled as "You")
    let mic_path_buf = PathBuf::from(&segment.mic_path);
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
    for seg in &mic_result.segments {
        if !should_skip_segment(&seg.text) {
            db.add_transcript_segment(
                &segment.note_id,
                seg.start_time,
                seg.end_time,
                &seg.text,
                Some("You"),
                Some("segment"),
                Some(segment_id),
            )
            .map_err(|e| e.to_string())?;
            total_segments += 1;
        }
    }

    // Transcribe system audio if it exists (labeled as "Others")
    if let Some(sys_path) = &segment.system_path {
        let sys_path_buf = PathBuf::from(sys_path);
        let transcriber_clone = transcriber.clone();

        match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&sys_path_buf)).await {
            Ok(Ok(result)) => {
                for seg in &result.segments {
                    if !should_skip_segment(&seg.text) {
                        db.add_transcript_segment(
                            &segment.note_id,
                            seg.start_time,
                            seg.end_time,
                            &seg.text,
                            Some("Others"),
                            Some("segment"),
                            Some(segment_id),
                        )
                        .map_err(|e| e.to_string())?;
                        total_segments += 1;
                    }
                }
            }
            Ok(Err(e)) => {
                eprintln!("Failed to transcribe system audio: {}", e);
            }
            Err(e) => {
                eprintln!("Failed to spawn system audio transcription task: {}", e);
            }
        }
    }

    state.is_transcribing.store(false, Ordering::SeqCst);

    Ok(total_segments)
}

/// Retranscribe all audio sources in a note
#[tauri::command]
pub async fn retranscribe_note(
    note_id: String,
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<RetranscribeResult, String> {
    // Check if already transcribing
    if state.is_transcribing.swap(true, Ordering::SeqCst) {
        return Err("Already transcribing. Please wait for the current transcription to finish.".to_string());
    }

    // Get the transcriber
    let transcriber = {
        let guard = state.transcriber.lock().map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;
        guard.clone().ok_or_else(|| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            "No model loaded. Please load a Whisper model first.".to_string()
        })?
    };

    // Get all audio segments and uploads for this note
    let segments = db.get_audio_segments(&note_id).map_err(|e| {
        state.is_transcribing.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    let uploads = db.get_uploaded_audio(&note_id).map_err(|e| {
        state.is_transcribing.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    let total_items = segments.len() + uploads.len();
    let mut completed_items = 0;
    let mut failed_items: Vec<String> = Vec::new();
    let mut total_segments_created = 0;

    // Emit initial progress
    let _ = app.emit("retranscribe-progress", serde_json::json!({
        "noteId": note_id,
        "totalItems": total_items,
        "completedItems": completed_items,
        "currentItem": "",
    }));

    // Process audio segments
    for segment in &segments {
        let item_name = format!("Recording {}", segment.segment_index + 1);

        // Emit progress
        let _ = app.emit("retranscribe-progress", serde_json::json!({
            "noteId": note_id,
            "totalItems": total_items,
            "completedItems": completed_items,
            "currentItem": item_name,
        }));

        // Delete existing transcripts for this segment
        if let Err(e) = db.delete_transcript_segments_by_source("segment", segment.id) {
            failed_items.push(format!("{}: {}", item_name, e));
            continue;
        }

        // Transcribe mic audio
        let mic_path_buf = PathBuf::from(&segment.mic_path);
        let transcriber_clone = transcriber.clone();

        match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&mic_path_buf)).await {
            Ok(Ok(result)) => {
                for seg in &result.segments {
                    if !should_skip_segment(&seg.text) {
                        if let Ok(_) = db.add_transcript_segment(
                            &note_id,
                            seg.start_time,
                            seg.end_time,
                            &seg.text,
                            Some("You"),
                            Some("segment"),
                            Some(segment.id),
                        ) {
                            total_segments_created += 1;
                        }
                    }
                }
            }
            Ok(Err(e)) => {
                failed_items.push(format!("{} (mic): {}", item_name, e));
            }
            Err(e) => {
                failed_items.push(format!("{} (mic): {}", item_name, e));
            }
        }

        // Transcribe system audio if it exists
        if let Some(sys_path) = &segment.system_path {
            let sys_path_buf = PathBuf::from(sys_path);
            let transcriber_clone = transcriber.clone();

            match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&sys_path_buf)).await {
                Ok(Ok(result)) => {
                    for seg in &result.segments {
                        if !should_skip_segment(&seg.text) {
                            if let Ok(_) = db.add_transcript_segment(
                                &note_id,
                                seg.start_time,
                                seg.end_time,
                                &seg.text,
                                Some("Others"),
                                Some("segment"),
                                Some(segment.id),
                            ) {
                                total_segments_created += 1;
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Failed to transcribe system audio for segment {}: {}", segment.id, e);
                }
                Err(e) => {
                    eprintln!("Failed to spawn system audio transcription for segment {}: {}", segment.id, e);
                }
            }
        }

        completed_items += 1;
    }

    // Process uploaded audio files
    for upload in &uploads {
        let item_name = upload.original_filename.clone();

        // Emit progress
        let _ = app.emit("retranscribe-progress", serde_json::json!({
            "noteId": note_id,
            "totalItems": total_items,
            "completedItems": completed_items,
            "currentItem": item_name,
        }));

        // Update status to processing
        let _ = db.update_uploaded_audio_status(upload.id, "processing");

        // Delete existing transcripts for this upload
        if let Err(e) = db.delete_transcript_segments_by_source("upload", upload.id) {
            let _ = db.update_uploaded_audio_status(upload.id, "failed");
            failed_items.push(format!("{}: {}", item_name, e));
            continue;
        }

        // Transcribe
        let file_path = PathBuf::from(&upload.file_path);
        let transcriber_clone = transcriber.clone();

        match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&file_path)).await {
            Ok(Ok(result)) => {
                for seg in &result.segments {
                    if !should_skip_segment(&seg.text) {
                        if let Ok(_) = db.add_transcript_segment(
                            &note_id,
                            seg.start_time,
                            seg.end_time,
                            &seg.text,
                            Some(&upload.speaker_label),
                            Some("upload"),
                            Some(upload.id),
                        ) {
                            total_segments_created += 1;
                        }
                    }
                }
                let _ = db.update_uploaded_audio_status(upload.id, "completed");
            }
            Ok(Err(e)) => {
                let _ = db.update_uploaded_audio_status(upload.id, "failed");
                failed_items.push(format!("{}: {}", item_name, e));
            }
            Err(e) => {
                let _ = db.update_uploaded_audio_status(upload.id, "failed");
                failed_items.push(format!("{}: {}", item_name, e));
            }
        }

        completed_items += 1;
    }

    state.is_transcribing.store(false, Ordering::SeqCst);

    // Emit final progress
    let _ = app.emit("retranscribe-progress", serde_json::json!({
        "noteId": note_id,
        "totalItems": total_items,
        "completedItems": completed_items,
        "currentItem": "",
        "isComplete": true,
    }));

    Ok(RetranscribeResult {
        total_items,
        completed_items,
        failed_items,
        total_segments: total_segments_created,
    })
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
