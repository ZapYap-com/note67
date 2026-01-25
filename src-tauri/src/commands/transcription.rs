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

/// Calculate text similarity between two strings (0.0 to 1.0)
/// Uses word overlap ratio for simplicity
fn text_similarity(a: &str, b: &str) -> f64 {
    let words_a: std::collections::HashSet<&str> = a.split_whitespace().collect();
    let words_b: std::collections::HashSet<&str> = b.split_whitespace().collect();
    
    if words_a.is_empty() && words_b.is_empty() {
        return 1.0;
    }
    if words_a.is_empty() || words_b.is_empty() {
        return 0.0;
    }
    
    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    
    if union == 0 {
        return 0.0;
    }
    
    intersection as f64 / union as f64
}

/// Result of re-transcription
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetranscribeResult {
    /// Number of segments deleted
    pub deleted_segments: usize,
    /// Number of new segments created
    pub new_segments: usize,
    /// Audio files that were transcribed
    pub transcribed_files: Vec<String>,
}

/// Re-transcribe all audio files for a note
/// 
/// This deletes existing transcript segments and re-transcribes all audio files
/// found in the recordings directory for this note.
#[tauri::command]
pub async fn retranscribe_note(
    note_id: String,
    app: tauri::AppHandle,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<RetranscribeResult, String> {
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

    // Get recordings directory
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            format!("Failed to get app data dir: {}", e)
        })?;
    let recordings_dir = app_data_dir.join("recordings");

    // Find all audio files for this note
    let mut audio_files: Vec<(PathBuf, Option<&str>)> = Vec::new();

    // Check for main mic/system files
    let mic_path = recordings_dir.join(format!("{}_mic.wav", note_id));
    let system_path = recordings_dir.join(format!("{}_system.wav", note_id));

    if mic_path.exists() {
        audio_files.push((mic_path, Some("You")));
    }
    if system_path.exists() {
        audio_files.push((system_path, Some("Others")));
    }

    // Check for segment files (e.g., {note_id}_mic_seg0.wav)
    if recordings_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&recordings_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                    if filename.starts_with(&note_id) && filename.ends_with(".wav") {
                        // Skip already added files and playback/mixed files
                        if filename == format!("{}_mic.wav", note_id) 
                            || filename == format!("{}_system.wav", note_id)
                            || filename == format!("{}.wav", note_id) {
                            continue;
                        }
                        
                        // Determine speaker based on filename
                        let speaker = if filename.contains("_mic") {
                            Some("You")
                        } else if filename.contains("_system") {
                            Some("Others")
                        } else {
                            None
                        };
                        
                        audio_files.push((path, speaker));
                    }
                }
            }
        }
    }

    if audio_files.is_empty() {
        state.is_transcribing.store(false, Ordering::SeqCst);
        return Err("No audio files found for this note.".to_string());
    }

    // Delete existing transcript segments for this note
    let deleted_segments = db
        .delete_transcript_segments(&note_id)
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            e.to_string()
        })?;

    // Collect all segments first for deduplication
    struct PendingSegment {
        start_time: f64,
        end_time: f64,
        text: String,
        speaker: Option<String>,
    }
    let mut all_segments: Vec<PendingSegment> = Vec::new();
    let mut transcribed_files = Vec::new();

    for (audio_path, speaker) in audio_files {
        let path_str = audio_path.to_string_lossy().to_string();
        let transcriber_clone = transcriber.clone();
        let audio_path_clone = audio_path.clone();

        match tokio::task::spawn_blocking(move || transcriber_clone.transcribe(&audio_path_clone)).await {
            Ok(Ok(result)) => {
                for segment in &result.segments {
                    if !should_skip_segment(&segment.text) {
                        all_segments.push(PendingSegment {
                            start_time: segment.start_time,
                            end_time: segment.end_time,
                            text: segment.text.clone(),
                            speaker: speaker.map(|s| s.to_string()),
                        });
                    }
                }
                transcribed_files.push(path_str);
            }
            Ok(Err(e)) => {
                eprintln!("Failed to transcribe {}: {}", path_str, e);
            }
            Err(e) => {
                eprintln!("Failed to spawn transcription task for {}: {}", path_str, e);
            }
        }
    }

    // Deduplicate segments with similar timestamps and text
    // When system audio and mic audio produce the same transcript, keep only one
    let mut deduped_segments: Vec<PendingSegment> = Vec::new();
    
    for segment in all_segments {
        // Check if a similar segment already exists
        let is_duplicate = deduped_segments.iter().any(|existing| {
            // Check if timestamps are within 3 seconds of each other
            let time_diff = (existing.start_time - segment.start_time).abs();
            if time_diff > 3.0 {
                return false;
            }
            
            // Check text similarity (normalize and compare)
            let existing_text = existing.text.trim().to_lowercase();
            let new_text = segment.text.trim().to_lowercase();
            
            // If texts are very similar (one contains the other or they match)
            existing_text == new_text 
                || existing_text.contains(&new_text) 
                || new_text.contains(&existing_text)
                || text_similarity(&existing_text, &new_text) > 0.8
        });
        
        if !is_duplicate {
            deduped_segments.push(segment);
        }
    }

    // Sort by start time
    deduped_segments.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap_or(std::cmp::Ordering::Equal));

    // Save deduplicated segments to database
    let mut new_segments = 0;
    for segment in deduped_segments {
        if let Ok(_) = db.add_transcript_segment(
            &note_id,
            segment.start_time,
            segment.end_time,
            &segment.text,
            segment.speaker.as_deref(),
            None,
            None,
        ) {
            new_segments += 1;
        }
    }

    state.is_transcribing.store(false, Ordering::SeqCst);

    Ok(RetranscribeResult {
        deleted_segments,
        new_segments,
        transcribed_files,
    })
}
