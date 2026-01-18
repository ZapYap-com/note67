//! Commands for uploading and managing external audio files.

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::audio::converter::{convert_to_wav, get_audio_duration_ms, is_supported_format};
use crate::commands::transcription::TranscriptionState;
use crate::db::models::UploadedAudio;
use crate::db::Database;

/// Upload and convert an audio file for a note
///
/// The file will be converted to 16kHz mono WAV for Whisper transcription.
#[tauri::command]
pub async fn upload_audio(
    app: AppHandle,
    note_id: String,
    source_path: String,
    speaker_label: Option<String>,
    db: State<'_, Database>,
) -> Result<UploadedAudio, String> {
    let source = PathBuf::from(&source_path);

    // Validate file exists
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    // Validate format
    if !is_supported_format(&source) {
        return Err(
            "Unsupported audio format. Supported formats: mp3, m4a, wav, webm, ogg, flac, aac, wma"
                .to_string(),
        );
    }

    // Get original filename
    let original_filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Generate unique filename for storage
    let upload_id = &Uuid::new_v4().to_string()[..8];
    let output_filename = format!("{}_upload_{}.wav", note_id, upload_id);
    let temp_filename = format!("{}_upload_{}.wav.tmp", note_id, upload_id);

    // Get recordings directory
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let recordings_dir = app_data.join("recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings directory: {}", e))?;

    let temp_path = recordings_dir.join(&temp_filename);
    let output_path = recordings_dir.join(&output_filename);

    // Convert to WAV using temp file first
    // If app closes mid-conversion, only .tmp file remains (cleaned up on next startup)
    let convert_result = convert_to_wav(&source, &temp_path);

    if let Err(e) = convert_result {
        // Clean up temp file on failure
        let _ = std::fs::remove_file(&temp_path);
        return Err(e.to_string());
    }

    // Rename temp to final (atomic on most filesystems)
    std::fs::rename(&temp_path, &output_path)
        .map_err(|e| format!("Failed to finalize converted file: {}", e))?;

    // Get duration from the converted file
    let duration_ms = get_audio_duration_ms(&output_path).ok();

    // Insert into database
    let speaker = speaker_label.unwrap_or_else(|| "Uploaded".to_string());
    let id = db
        .add_uploaded_audio(
            &note_id,
            output_path.to_str().unwrap(),
            &original_filename,
            duration_ms,
            &speaker,
        )
        .map_err(|e| e.to_string())?;

    // Return the created record
    db.get_uploaded_audio_by_id(id).map_err(|e| e.to_string())
}

/// Get all uploaded audio for a note
#[tauri::command]
pub fn get_uploaded_audio(
    note_id: String,
    db: State<Database>,
) -> Result<Vec<UploadedAudio>, String> {
    db.get_uploaded_audio(&note_id).map_err(|e| e.to_string())
}

/// Delete uploaded audio and its file
#[tauri::command]
pub fn delete_uploaded_audio(upload_id: i64, db: State<Database>) -> Result<(), String> {
    // Get file path first
    let info = db
        .get_uploaded_audio_by_id(upload_id)
        .map_err(|e| e.to_string())?;

    // Delete the file (ignore errors - file might not exist)
    let path = PathBuf::from(&info.file_path);
    let _ = std::fs::remove_file(&path);

    // Delete database record
    db.delete_uploaded_audio(upload_id)
        .map_err(|e| e.to_string())
}

/// Transcribe an uploaded audio file
#[tauri::command]
pub async fn transcribe_uploaded_audio(
    upload_id: i64,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<usize, String> {
    // Get the upload info
    let info = db
        .get_uploaded_audio_by_id(upload_id)
        .map_err(|e| e.to_string())?;

    // Check if already transcribing
    if state.is_transcribing.swap(true, Ordering::SeqCst) {
        return Err("Already transcribing. Please wait for the current transcription to finish.".to_string());
    }

    // Update status to processing
    db.update_uploaded_audio_status(upload_id, "processing")
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

    // Run transcription
    let path = PathBuf::from(&info.file_path);
    let result = tokio::task::spawn_blocking(move || transcriber.transcribe(&path))
        .await
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            let _ = db.update_uploaded_audio_status(upload_id, "failed");
            e.to_string()
        })?
        .map_err(|e| {
            state.is_transcribing.store(false, Ordering::SeqCst);
            let _ = db.update_uploaded_audio_status(upload_id, "failed");
            e.to_string()
        })?;

    // Save transcript segments with the speaker label
    let mut saved_count = 0;
    for segment in &result.segments {
        // Skip blank/noise segments
        let text_lower = segment.text.to_lowercase();
        if text_lower.contains("[blank_audio]")
            || text_lower.contains("[inaudible]")
            || text_lower.contains("[silence]")
            || text_lower.contains("[music]")
            || segment.text.trim().is_empty()
        {
            continue;
        }

        db.add_transcript_segment(
            &info.note_id,
            segment.start_time,
            segment.end_time,
            &segment.text,
            Some(&info.speaker_label),
        )
        .map_err(|e| e.to_string())?;
        saved_count += 1;
    }

    // Update status to completed
    db.update_uploaded_audio_status(upload_id, "completed")
        .map_err(|e| e.to_string())?;

    state.is_transcribing.store(false, Ordering::SeqCst);

    Ok(saved_count)
}

/// Update speaker label for uploaded audio
#[tauri::command]
pub fn update_uploaded_audio_speaker(
    upload_id: i64,
    speaker_label: String,
    db: State<Database>,
) -> Result<(), String> {
    db.update_uploaded_audio_speaker(upload_id, &speaker_label)
        .map_err(|e| e.to_string())
}

/// Item for reordering
#[derive(Debug, serde::Deserialize)]
pub struct ReorderItem {
    pub item_type: String,
    pub id: i64,
    pub order: i32,
}

/// Reorder audio items for a note
#[tauri::command]
pub fn reorder_audio_items(
    items: Vec<ReorderItem>,
    db: State<Database>,
) -> Result<(), String> {
    let tuples: Vec<(String, i64, i32)> = items
        .into_iter()
        .map(|item| (item.item_type, item.id, item.order))
        .collect();
    db.reorder_audio_items(&tuples).map_err(|e| e.to_string())
}

