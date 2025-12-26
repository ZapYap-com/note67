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
    pub meeting_id: String,
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

/// Generate a summary for a meeting
#[tauri::command]
pub async fn generate_summary(
    meeting_id: String,
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
        .get_transcript_segments(&meeting_id)
        .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("No transcript found for this meeting. Please transcribe the audio first.".to_string());
    }

    // Combine segments into full transcript
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .collect::<Vec<_>>()
        .join(" ");

    // Parse summary type
    let stype = SummaryType::from_str(&summary_type);

    // Build prompt based on summary type
    let prompt = match stype {
        SummaryType::Overview => SummaryPrompts::overview(&transcript),
        SummaryType::ActionItems => SummaryPrompts::action_items(&transcript),
        SummaryType::KeyDecisions => SummaryPrompts::key_decisions(&transcript),
        SummaryType::Custom => {
            let user_prompt = custom_prompt.unwrap_or_else(|| "Summarize this meeting.".to_string());
            SummaryPrompts::custom(&transcript, &user_prompt)
        }
    };

    // Generate with Ollama
    let response = ai_state
        .client
        .generate(&model, &prompt, 0.7, Some(4096))
        .await
        .map_err(|e| e.to_string())?;

    // Save to database
    let summary_id = db
        .add_summary(&meeting_id, &stype, &response)
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
    pub meeting_id: String,
    pub chunk: String,
    pub is_done: bool,
}

/// Generate a summary for a meeting with streaming
#[tauri::command]
pub async fn generate_summary_stream(
    app: AppHandle,
    meeting_id: String,
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
        .get_transcript_segments(&meeting_id)
        .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("No transcript found for this meeting. Please transcribe the audio first.".to_string());
    }

    // Combine segments into full transcript
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .collect::<Vec<_>>()
        .join(" ");

    // Parse summary type
    let stype = SummaryType::from_str(&summary_type);

    // Build prompt based on summary type
    let prompt = match stype {
        SummaryType::Overview => SummaryPrompts::overview(&transcript),
        SummaryType::ActionItems => SummaryPrompts::action_items(&transcript),
        SummaryType::KeyDecisions => SummaryPrompts::key_decisions(&transcript),
        SummaryType::Custom => {
            let user_prompt = custom_prompt.unwrap_or_else(|| "Summarize this meeting.".to_string());
            SummaryPrompts::custom(&transcript, &user_prompt)
        }
    };

    // Create channel for streaming
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);
    let app_clone = app.clone();
    let meeting_id_clone = meeting_id.clone();

    // Spawn task to receive chunks and emit events
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let event = SummaryStreamEvent {
                meeting_id: meeting_id_clone.clone(),
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
        meeting_id: meeting_id.clone(),
        chunk: String::new(),
        is_done: true,
    };
    let _ = app.emit("summary-stream", done_event);

    // Save to database
    let summary_id = db
        .add_summary(&meeting_id, &stype, &response)
        .map_err(|e| e.to_string())?;

    // Fetch the saved summary
    let summary = db
        .get_summary(summary_id)
        .map_err(|e| e.to_string())?
        .ok_or("Failed to retrieve saved summary")?;

    Ok(summary)
}

/// Get all summaries for a meeting
#[tauri::command]
pub fn get_meeting_summaries(
    meeting_id: String,
    db: State<'_, Database>,
) -> Result<Vec<Summary>, String> {
    db.get_summaries(&meeting_id).map_err(|e| e.to_string())
}

/// Delete a summary
#[tauri::command]
pub fn delete_summary(summary_id: i64, db: State<'_, Database>) -> Result<(), String> {
    db.delete_summary(summary_id).map_err(|e| e.to_string())
}

/// Generate a title for a meeting based on its transcript
#[tauri::command]
pub async fn generate_title(
    meeting_id: String,
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
        .get_transcript_segments(&meeting_id)
        .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("No transcript found for this meeting.".to_string());
    }

    // Combine segments into full transcript (limit to first ~2000 chars to keep prompt small)
    let transcript: String = segments
        .iter()
        .map(|s| s.text.clone())
        .collect::<Vec<_>>()
        .join(" ");
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

    // Clean up the response - remove quotes and trim
    let title = response
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();

    // Update meeting title in database
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now();
        conn.execute(
            "UPDATE meetings SET title = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&title, now.to_rfc3339(), &meeting_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(title)
}
