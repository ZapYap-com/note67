use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::ai::{OllamaClient, OllamaModel, SummaryPrompts};
use crate::db::models::{Summary, SummaryType};
use crate::db::Database;

pub struct AiState {
    pub client: Arc<OllamaClient>,
    pub selected_model: Mutex<Option<String>>,
    pub is_generating: AtomicBool,
}

impl Default for AiState {
    fn default() -> Self {
        Self {
            client: Arc::new(OllamaClient::new()),
            selected_model: Mutex::new(None),
            is_generating: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<OllamaModel>,
    pub selected_model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateSummaryRequest {
    pub note_id: String,
    pub summary_type: String,
    pub custom_prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateSummaryResponse {
    pub summary: Summary,
}

/// Check if Ollama is running and get available models
#[tauri::command]
pub async fn get_ollama_status(state: State<'_, AiState>) -> Result<OllamaStatus, String> {
    let running = state.client.is_running().await;

    let models = if running {
        state.client.list_models().await.unwrap_or_default()
    } else {
        vec![]
    };

    let selected_model = state.selected_model.lock().await.clone();

    Ok(OllamaStatus {
        running,
        models,
        selected_model,
    })
}

/// List available Ollama models
#[tauri::command]
pub async fn list_ollama_models(state: State<'_, AiState>) -> Result<Vec<OllamaModel>, String> {
    state
        .client
        .list_models()
        .await
        .map_err(|e| e.to_string())
}

/// Select a model to use for summaries
#[tauri::command]
pub async fn select_ollama_model(
    model_name: String,
    state: State<'_, AiState>,
) -> Result<(), String> {
    let models = state
        .client
        .list_models()
        .await
        .map_err(|e| e.to_string())?;

    if !models.iter().any(|m| m.name == model_name) {
        return Err(format!("Model '{}' not found", model_name));
    }

    *state.selected_model.lock().await = Some(model_name);
    Ok(())
}

/// Get the currently selected model
#[tauri::command]
pub async fn get_selected_model(state: State<'_, AiState>) -> Result<Option<String>, String> {
    Ok(state.selected_model.lock().await.clone())
}

/// Check if AI is currently generating
#[tauri::command]
pub fn is_ai_generating(state: State<'_, AiState>) -> bool {
    state.is_generating.load(Ordering::SeqCst)
}

/// Generate a summary for a note
#[tauri::command]
pub async fn generate_summary(
    note_id: String,
    summary_type: String,
    custom_prompt: Option<String>,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<Summary, String> {
    // Check if already generating
    if ai_state.is_generating.swap(true, Ordering::SeqCst) {
        return Err("Already generating a summary".to_string());
    }

    // Ensure we reset the flag when done
    let _guard = scopeguard::guard((), |_| {
        ai_state.is_generating.store(false, Ordering::SeqCst);
    });

    // Get selected model
    let model = ai_state
        .selected_model
        .lock()
        .await
        .clone()
        .ok_or("No model selected. Please select a model first.")?;

    // Get transcript from database
    let segments = db
        .get_transcript_segments(&note_id)
        .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("No transcript found for this note. Please transcribe the audio first.".to_string());
    }

    // Combine segments into full transcript, filtering out blank audio markers
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .filter(|text| !text.contains("[BLANK_AUDIO]"))
        .collect::<Vec<_>>()
        .join(" ");

    if transcript.trim().is_empty() {
        return Err("No meaningful transcript found (only silence detected).".to_string());
    }

    // Parse summary type
    let stype = SummaryType::from_str(&summary_type);

    // Build prompt based on summary type
    let prompt = match stype {
        SummaryType::Overview => SummaryPrompts::overview(&transcript),
        SummaryType::ActionItems => SummaryPrompts::action_items(&transcript),
        SummaryType::KeyDecisions => SummaryPrompts::key_decisions(&transcript),
        SummaryType::Custom => {
            let user_prompt = custom_prompt.unwrap_or_else(|| "Summarize this note.".to_string());
            SummaryPrompts::custom(&transcript, &user_prompt)
        }
    };

    // Generate with Ollama
    let response = ai_state
        .client
        .generate(&model, &prompt, 0.7, Some(4096))
        .await
        .map_err(|e| e.to_string())?;

    // Strip thinking tags from response
    let clean_response = strip_thinking_tags(&response);

    // Save to database
    let summary_id = db
        .add_summary(&note_id, &stype, &clean_response)
        .map_err(|e| e.to_string())?;

    // Fetch the saved summary
    let summary = db
        .get_summary(summary_id)
        .map_err(|e| e.to_string())?
        .ok_or("Failed to retrieve saved summary")?;

    Ok(summary)
}

/// Event payload for streaming summary updates
#[derive(Clone, Serialize)]
pub struct SummaryStreamEvent {
    pub note_id: String,
    pub chunk: String,
    pub is_done: bool,
}

/// Generate a summary for a note with streaming
#[tauri::command]
pub async fn generate_summary_stream(
    app: AppHandle,
    note_id: String,
    summary_type: String,
    custom_prompt: Option<String>,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<Summary, String> {
    // Check if already generating
    if ai_state.is_generating.swap(true, Ordering::SeqCst) {
        return Err("Already generating a summary".to_string());
    }

    // Ensure we reset the flag when done
    let _guard = scopeguard::guard((), |_| {
        ai_state.is_generating.store(false, Ordering::SeqCst);
    });

    // Get selected model
    let model = ai_state
        .selected_model
        .lock()
        .await
        .clone()
        .ok_or("No model selected. Please select a model first.")?;

    // Get transcript from database
    let segments = db
        .get_transcript_segments(&note_id)
        .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("No transcript found for this note. Please transcribe the audio first.".to_string());
    }

    // Combine segments into full transcript, filtering out blank audio markers
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .filter(|text| !text.contains("[BLANK_AUDIO]"))
        .collect::<Vec<_>>()
        .join(" ");

    if transcript.trim().is_empty() {
        return Err("No meaningful transcript found (only silence detected).".to_string());
    }

    // Parse summary type
    let stype = SummaryType::from_str(&summary_type);

    // Build prompt based on summary type
    let prompt = match stype {
        SummaryType::Overview => SummaryPrompts::overview(&transcript),
        SummaryType::ActionItems => SummaryPrompts::action_items(&transcript),
        SummaryType::KeyDecisions => SummaryPrompts::key_decisions(&transcript),
        SummaryType::Custom => {
            let user_prompt = custom_prompt.unwrap_or_else(|| "Summarize this note.".to_string());
            SummaryPrompts::custom(&transcript, &user_prompt)
        }
    };

    // Create channel for streaming
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);
    let app_clone = app.clone();
    let note_id_clone = note_id.clone();

    // Spawn task to receive chunks and emit events
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let event = SummaryStreamEvent {
                note_id: note_id_clone.clone(),
                chunk,
                is_done: false,
            };
            let _ = app_clone.emit("summary-stream", event);
        }
    });

    // Generate with Ollama streaming
    let response = ai_state
        .client
        .generate_stream(&model, &prompt, 0.7, Some(4096), tx)
        .await
        .map_err(|e| e.to_string())?;

    // Emit done event
    let done_event = SummaryStreamEvent {
        note_id: note_id.clone(),
        chunk: String::new(),
        is_done: true,
    };
    let _ = app.emit("summary-stream", done_event);

    // Strip thinking tags from response
    let clean_response = strip_thinking_tags(&response);

    // Save to database
    let summary_id = db
        .add_summary(&note_id, &stype, &clean_response)
        .map_err(|e| e.to_string())?;

    // Fetch the saved summary
    let summary = db
        .get_summary(summary_id)
        .map_err(|e| e.to_string())?
        .ok_or("Failed to retrieve saved summary")?;

    Ok(summary)
}

/// Get all summaries for a note
#[tauri::command]
pub fn get_note_summaries(
    note_id: String,
    db: State<'_, Database>,
) -> Result<Vec<Summary>, String> {
    db.get_summaries(&note_id).map_err(|e| e.to_string())
}

/// Delete a summary
#[tauri::command]
pub fn delete_summary(summary_id: i64, db: State<'_, Database>) -> Result<(), String> {
    db.delete_summary(summary_id).map_err(|e| e.to_string())
}

/// Generate a title for a note based on its transcript
#[tauri::command]
pub async fn generate_title(
    note_id: String,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<String, String> {
    // Get selected model
    let model = ai_state
        .selected_model
        .lock()
        .await
        .clone()
        .ok_or("No model selected. Please select a model first.")?;

    // Get transcript from database
    let segments = db
        .get_transcript_segments(&note_id)
        .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("No transcript found for this note.".to_string());
    }

    // Combine segments, filtering out blank audio markers (limit to ~2000 chars)
    let transcript: String = segments
        .iter()
        .map(|s| s.text.clone())
        .filter(|text| !text.contains("[BLANK_AUDIO]"))
        .collect::<Vec<_>>()
        .join(" ");

    if transcript.trim().is_empty() {
        return Err("No meaningful transcript found (only silence detected).".to_string());
    }

    let truncated = if transcript.len() > 2000 {
        format!("{}...", &transcript[..2000])
    } else {
        transcript
    };

    // Build prompt
    let prompt = SummaryPrompts::title(&truncated);

    // Generate with Ollama (low temperature for consistent output)
    let response = ai_state
        .client
        .generate(&model, &prompt, 0.3, Some(100))
        .await
        .map_err(|e| e.to_string())?;

    // Clean up the response - remove thinking tags, quotes, and trim
    let title = strip_thinking_tags(&response)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();

    // Update note title in database
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now();
        conn.execute(
            "UPDATE notes SET title = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&title, now.to_rfc3339(), &note_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(title)
}

/// Generate a title for a note based on a summary content
#[tauri::command]
pub async fn generate_title_from_summary(
    note_id: String,
    summary_content: String,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<String, String> {
    // Get selected model
    let model = ai_state
        .selected_model
        .lock()
        .await
        .clone()
        .ok_or("No model selected. Please select a model first.")?;

    // Truncate summary if too long
    let truncated = if summary_content.len() > 2000 {
        format!("{}...", &summary_content[..2000])
    } else {
        summary_content
    };

    // Build prompt
    let prompt = SummaryPrompts::title_from_summary(&truncated);

    // Generate with Ollama (low temperature for consistent output)
    let response = ai_state
        .client
        .generate(&model, &prompt, 0.3, Some(100))
        .await
        .map_err(|e| e.to_string())?;

    // Clean up the response - remove thinking tags, quotes, and trim
    let title = strip_thinking_tags(&response)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();

    // Update note title in database
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now();
        conn.execute(
            "UPDATE notes SET title = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&title, now.to_rfc3339(), &note_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(title)
}

/// Strip thinking tags from LLM responses (used by reasoning models like DeepSeek)
/// Handles: <think>, <thinking>, and variations with different casing
/// Also handles cases where opening tag is missing but closing tag exists
fn strip_thinking_tags(text: &str) -> String {
    let mut result = text.to_string();

    // List of tag patterns to remove (open tag, close tag)
    let tag_patterns = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
    ];

    for (open_tag, close_tag) in tag_patterns {
        loop {
            let lower = result.to_lowercase();

            // Check if we have a closing tag
            if let Some(end_pos) = lower.find(close_tag) {
                // Look for matching opening tag
                if let Some(start) = lower.find(open_tag) {
                    // Both tags found - remove everything between them (inclusive)
                    let end = end_pos + close_tag.len();
                    result = format!("{}{}", &result[..start], &result[end..]);
                } else {
                    // Only closing tag found - remove everything before and including it
                    // This handles cases where the model starts with thinking content
                    let end = end_pos + close_tag.len();
                    result = result[end..].to_string();
                }
            } else if let Some(start) = lower.find(open_tag) {
                // Only opening tag found - remove everything from it onwards
                result = result[..start].to_string();
                break;
            } else {
                // No tags found
                break;
            }
        }
    }

    result.trim().to_string()
}
