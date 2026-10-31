//! Commands for uploading and managing external audio files.

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

use crate::audio::converter::{
    convert_to_wav, get_audio_duration_ms, is_supported_format, SUPPORTED_EXTENSIONS,
};
use crate::commands::transcription::{
    batch_language, clamp_monotonic, take_transcription_slot, TranscriptionState,
};
use crate::transcription::should_skip_segment;
use crate::db::models::{NewTranscriptSegment, UploadedAudio};
use crate::db::Database;
use crate::paths::validate_note_id;

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
    validate_note_id(&note_id)?;
    let source = PathBuf::from(&source_path);

    // Only a file the user picked: the open dialog adds each pick to the fs
    // scope. Otherwise the webview could copy any audio on disk into the
    // recordings folder, which it can read.
    if !app.fs_scope().is_allowed(&source) {
        return Err("Choose the audio file to import".to_string());
    }

    // Validate file exists
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    // Validate format
    if !is_supported_format(&source) {
        return Err(format!(
            "Unsupported audio format. Supported formats: {}",
            SUPPORTED_EXTENSIONS.join(", ")
        ));
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

/// Delete uploaded audio, its file, and associated transcripts
#[tauri::command]
pub fn delete_uploaded_audio(upload_id: i64, db: State<Database>) -> Result<(), String> {
    // Get file path first
    let info = db
        .get_uploaded_audio_by_id(upload_id)
        .map_err(|e| e.to_string())?;

    // Delete the file (ignore errors - file might not exist)
    let path = PathBuf::from(&info.file_path);
    let _ = std::fs::remove_file(&path);

    // Delete associated transcript segments
    db.delete_transcript_segments_by_source("upload", upload_id)
        .map_err(|e| e.to_string())?;

    // Delete database record
    db.delete_uploaded_audio(upload_id)
        .map_err(|e| e.to_string())
}

/// Transcribe an uploaded audio file (also used for retranscription)
///
/// Transcribes first and swaps the import's lines in one transaction at the
/// end. It used to delete the import's transcript up front, so a failed
/// re-transcribe left it with none, and two `?` returns skipped resetting
/// `is_transcribing`, leaving every later transcription (including the
/// post-recording pass) failing with "Already transcribing" until restart.
#[tauri::command]
pub async fn transcribe_uploaded_audio(
    upload_id: i64,
    state: State<'_, TranscriptionState>,
    db: State<'_, Database>,
) -> Result<usize, String> {
    let info = db
        .get_uploaded_audio_by_id(upload_id)
        .map_err(|e| e.to_string())?;

    take_transcription_slot(&state.is_transcribing).await;
    // Cleared on every way out of this function.
    let _busy = scopeguard::guard((), |_| {
        state.is_transcribing.store(false, Ordering::SeqCst);
    });

    let transcriber = state
        .transcriber
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No model loaded. Please load a Whisper model first.")?;

    db.update_uploaded_audio_status(upload_id, "processing")
        .map_err(|e| e.to_string())?;

    let path = PathBuf::from(&info.file_path);
    let lang = batch_language(&db);
    let result = match tokio::task::spawn_blocking(move || transcriber.transcribe(&path, lang.as_deref())).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => {
            let _ = db.update_uploaded_audio_status(upload_id, "failed");
            return Err(e.to_string());
        }
        Err(e) => {
            let _ = db.update_uploaded_audio_status(upload_id, "failed");
            return Err(e.to_string());
        }
    };

    // The same filter and time handling as the note-wide pass, so both paths
    // produce the same lines for the same file.
    let mut last_start = 0.0_f64;
    let segments: Vec<NewTranscriptSegment> = result
        .segments
        .iter()
        .filter(|seg| !should_skip_segment(&seg.text, seg.start_time, seg.end_time))
        .map(|seg| {
            let (start, end) = clamp_monotonic(seg.start_time, seg.end_time, &mut last_start);
            NewTranscriptSegment::new(&info.note_id, start, end, &seg.text)
                .with_speaker(Some(info.speaker_label.clone()))
                .with_source("upload", upload_id)
        })
        .collect();

    // A pass that heard nothing never replaces a transcript (as in retranscribe_note).
    let saved = if segments.is_empty() {
        0
    } else {
        db.replace_source_transcript("upload", upload_id, &segments)
            .map_err(|e| {
                let _ = db.update_uploaded_audio_status(upload_id, "failed");
                e.to_string()
            })?
    };

    db.update_uploaded_audio_status(upload_id, "completed")
        .map_err(|e| e.to_string())?;

    Ok(saved)
}

/// The file types the import picker offers: exactly what the converter accepts.
#[tauri::command]
pub fn supported_audio_formats() -> Vec<&'static str> {
    SUPPORTED_EXTENSIONS.to_vec()
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

