use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ai::prompts::MAX_CONTENT_LENGTH;
use crate::ai::{OllamaClient, OllamaModel, SummaryPrompts, WritingPrompts};
use crate::commands::links::update_incoming_links_internal;
use crate::db::models::{ActionItem, ActionItemWithNote, Summary, SummaryType};
use crate::db::Database;

/// The longest prefix of `text` that fits in `max_bytes` without splitting a
/// UTF-8 character. Slicing a String at a raw byte index panics when the
/// index lands inside a multi-byte character (CJK, em dashes, emoji), and the
/// release profile aborts on panic, so any byte-budget truncation of user or
/// model text goes through here.
fn truncate_on_char_boundary(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Split text into chunks of approximately max_size characters
/// Tries to split on sentence boundaries when possible
fn split_into_chunks(text: &str, max_size: usize) -> Vec<String> {
    if text.len() <= max_size {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current_chunk = String::new();

    // Split by sentences (rough approximation)
    for sentence in text.split_inclusive(['.', '!', '?']) {
        if current_chunk.len() + sentence.len() > max_size && !current_chunk.is_empty() {
            chunks.push(current_chunk.trim().to_string());
            current_chunk = String::new();
        }
        current_chunk.push_str(sentence);
    }

    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk.trim().to_string());
    }

    // If we still have chunks that are too large, force split them
    let mut final_chunks = Vec::new();
    for chunk in chunks {
        if chunk.len() <= max_size {
            final_chunks.push(chunk);
        } else {
            // Force split on word boundaries
            let words: Vec<&str> = chunk.split_whitespace().collect();
            let mut sub_chunk = String::new();
            for word in words {
                if sub_chunk.len() + word.len() + 1 > max_size && !sub_chunk.is_empty() {
                    final_chunks.push(sub_chunk.trim().to_string());
                    sub_chunk = String::new();
                }
                if !sub_chunk.is_empty() {
                    sub_chunk.push(' ');
                }
                sub_chunk.push_str(word);
            }
            if !sub_chunk.trim().is_empty() {
                final_chunks.push(sub_chunk.trim().to_string());
            }
        }
    }

    final_chunks
}

pub struct AiState {
    pub client: Arc<OllamaClient>,
    pub selected_model: Mutex<Option<String>>,
    pub is_generating: AtomicBool,
    /// Task extraction runs one at a time; a second click would duplicate it.
    pub is_extracting: AtomicBool,
}

impl Default for AiState {
    fn default() -> Self {
        Self {
            client: Arc::new(OllamaClient::new()),
            selected_model: Mutex::new(None),
            is_generating: AtomicBool::new(false),
            is_extracting: AtomicBool::new(false),
        }
    }
}

/// Settings key holding the chosen Ollama model.
const OLLAMA_MODEL_SETTING: &str = "ollama_model";

/// The model to generate with: the one picked this session, else the one
/// saved in settings.
///
/// The selection used to live only in memory. The frontend restored it once,
/// on its first status check, so when Ollama started after Note67 that check
/// found nothing to restore and every summary failed with "No model selected"
/// until the model was picked again.
async fn resolve_model(ai_state: &AiState, db: &Database) -> Option<String> {
    let mut selected = ai_state.selected_model.lock().await;
    if selected.is_none() {
        *selected = db
            .get_setting(OLLAMA_MODEL_SETTING)
            .ok()
            .flatten()
            .filter(|model| !model.is_empty());
    }
    selected.clone()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<OllamaModel>,
    pub selected_model: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateSummaryRequest {
    pub note_id: String,
    pub summary_type: String,
    pub custom_prompt: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateSummaryResponse {
    pub summary: Summary,
}

/// Check if Ollama is running and get available models
#[tauri::command]
pub async fn get_ollama_status(
    state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<OllamaStatus, String> {
    let running = state.client.is_running().await;

    let models = if running {
        state.client.list_models().await.unwrap_or_default()
    } else {
        vec![]
    };

    let mut selected_model = resolve_model(&state, &db).await;
    // A saved model that has since been removed from Ollama can't be used.
    if running
        && selected_model
            .as_ref()
            .is_some_and(|name| !models.iter().any(|m| &m.name == name))
    {
        selected_model = None;
        *state.selected_model.lock().await = None;
    }

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
    db: State<'_, Database>,
) -> Result<(), String> {
    let models = state
        .client
        .list_models()
        .await
        .map_err(|e| e.to_string())?;

    if !models.iter().any(|m| m.name == model_name) {
        return Err(format!("Model '{}' not found", model_name));
    }

    db.set_setting(OLLAMA_MODEL_SETTING, &model_name)
        .map_err(|e| e.to_string())?;
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
    let model = resolve_model(&ai_state, &db)
        .await
        .ok_or("No model selected. Please select a model first.")?;

    // Get transcript from database
    let segments = db
        .get_transcript_segments(&note_id)
        .map_err(|e| e.to_string())?;

    // Get user notes (description) from database
    let notes = db
        .get_note_description(&note_id)
        .map_err(|e| e.to_string())?;

    // Combine segments into full transcript, filtering out blank audio markers
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .filter(|text| !text.contains("[BLANK_AUDIO]"))
        .collect::<Vec<_>>()
        .join(" ");

    let has_transcript = !transcript.trim().is_empty();
    let has_notes = notes.as_ref().is_some_and(|n| !n.trim().is_empty());

    if !has_transcript && !has_notes {
        return Err("No content to summarize. Please add notes or record audio first.".to_string());
    }

    // Parse summary type
    let stype = SummaryType::from_str(&summary_type);
    let user_prompt_str = custom_prompt.unwrap_or_else(|| "Summarize this note.".to_string());

    // Check if we need to use chunked summarization
    let response = if has_transcript && transcript.len() > MAX_CONTENT_LENGTH {
        // Split transcript into chunks
        let chunks = split_into_chunks(&transcript, MAX_CONTENT_LENGTH);
        let total_chunks = chunks.len();

        // Summarize each chunk
        let mut chunk_summaries = Vec::new();
        for (i, chunk) in chunks.iter().enumerate() {
            let chunk_prompt = match stype {
                SummaryType::Overview => {
                    SummaryPrompts::chunk_overview(chunk, i + 1, total_chunks)
                }
                SummaryType::ActionItems => {
                    SummaryPrompts::chunk_action_items(chunk, i + 1, total_chunks)
                }
                SummaryType::KeyDecisions => {
                    SummaryPrompts::chunk_key_decisions(chunk, i + 1, total_chunks)
                }
                SummaryType::Custom => {
                    SummaryPrompts::chunk_custom(chunk, &user_prompt_str, i + 1, total_chunks)
                }
            };

            let chunk_response = ai_state
                .client
                .generate(&model, &chunk_prompt, 0.7, Some(4096))
                .await
                .map_err(|e| e.to_string())?;

            chunk_summaries.push(strip_thinking_tags(&chunk_response));
        }

        // Merge chunk summaries
        let merge_prompt = match stype {
            SummaryType::Overview => {
                SummaryPrompts::merge_overview(&chunk_summaries, notes.as_deref())
            }
            SummaryType::ActionItems => {
                SummaryPrompts::merge_action_items(&chunk_summaries, notes.as_deref())
            }
            SummaryType::KeyDecisions => {
                SummaryPrompts::merge_key_decisions(&chunk_summaries, notes.as_deref())
            }
            SummaryType::Custom => {
                SummaryPrompts::merge_custom(&chunk_summaries, &user_prompt_str, notes.as_deref())
            }
        };

        ai_state
            .client
            .generate(&model, &merge_prompt, 0.7, Some(4096))
            .await
            .map_err(|e| e.to_string())?
    } else if has_transcript {
        // Build prompt based on summary type (single pass with transcript)
        let prompt = match stype {
            SummaryType::Overview => SummaryPrompts::overview(&transcript, notes.as_deref()),
            SummaryType::ActionItems => {
                SummaryPrompts::action_items(&transcript, notes.as_deref())
            }
            SummaryType::KeyDecisions => {
                SummaryPrompts::key_decisions(&transcript, notes.as_deref())
            }
            SummaryType::Custom => {
                SummaryPrompts::custom(&transcript, &user_prompt_str, notes.as_deref())
            }
        };

        // Generate with Ollama
        ai_state
            .client
            .generate(&model, &prompt, 0.7, Some(4096))
            .await
            .map_err(|e| e.to_string())?
    } else {
        // Notes only (no transcript)
        let notes_content = notes.as_ref().unwrap();
        let prompt = match stype {
            SummaryType::Overview => SummaryPrompts::overview_notes_only(notes_content),
            SummaryType::ActionItems => SummaryPrompts::action_items_notes_only(notes_content),
            SummaryType::KeyDecisions => SummaryPrompts::key_decisions_notes_only(notes_content),
            SummaryType::Custom => {
                SummaryPrompts::custom_notes_only(notes_content, &user_prompt_str)
            }
        };

        // Generate with Ollama
        ai_state
            .client
            .generate(&model, &prompt, 0.7, Some(4096))
            .await
            .map_err(|e| e.to_string())?
    };

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
    let model = resolve_model(&ai_state, &db)
        .await
        .ok_or("No model selected. Please select a model first.")?;

    // Get transcript from database
    let segments = db
        .get_transcript_segments(&note_id)
        .map_err(|e| e.to_string())?;

    // Get user notes (description) from database
    let notes = db
        .get_note_description(&note_id)
        .map_err(|e| e.to_string())?;

    // Combine segments into full transcript, filtering out blank audio markers
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .filter(|text| !text.contains("[BLANK_AUDIO]"))
        .collect::<Vec<_>>()
        .join(" ");

    let has_transcript = !transcript.trim().is_empty();
    let has_notes = notes.as_ref().is_some_and(|n| !n.trim().is_empty());

    if !has_transcript && !has_notes {
        return Err("No content to summarize. Please add notes or record audio first.".to_string());
    }

    // Parse summary type
    let stype = SummaryType::from_str(&summary_type);
    let user_prompt_str = custom_prompt.unwrap_or_else(|| "Summarize this note.".to_string());

    // Check if we need to use chunked summarization
    let response = if has_transcript && transcript.len() > MAX_CONTENT_LENGTH {
        // Split transcript into chunks
        let chunks = split_into_chunks(&transcript, MAX_CONTENT_LENGTH);
        let total_chunks = chunks.len();

        // Emit a status message about processing chunks
        let status_event = SummaryStreamEvent {
            note_id: note_id.clone(),
            chunk: format!("Processing {} sections...\n\n", total_chunks),
            is_done: false,
        };
        let _ = app.emit("summary-stream", status_event);

        // Summarize each chunk (non-streaming for intermediate steps)
        let mut chunk_summaries = Vec::new();
        for (i, chunk) in chunks.iter().enumerate() {
            // Emit progress update
            let progress_event = SummaryStreamEvent {
                note_id: note_id.clone(),
                chunk: format!("Analyzing section {} of {}...\n", i + 1, total_chunks),
                is_done: false,
            };
            let _ = app.emit("summary-stream", progress_event);

            let chunk_prompt = match stype {
                SummaryType::Overview => {
                    SummaryPrompts::chunk_overview(chunk, i + 1, total_chunks)
                }
                SummaryType::ActionItems => {
                    SummaryPrompts::chunk_action_items(chunk, i + 1, total_chunks)
                }
                SummaryType::KeyDecisions => {
                    SummaryPrompts::chunk_key_decisions(chunk, i + 1, total_chunks)
                }
                SummaryType::Custom => {
                    SummaryPrompts::chunk_custom(chunk, &user_prompt_str, i + 1, total_chunks)
                }
            };

            let chunk_response = ai_state
                .client
                .generate(&model, &chunk_prompt, 0.7, Some(4096))
                .await
                .map_err(|e| e.to_string())?;

            chunk_summaries.push(strip_thinking_tags(&chunk_response));
        }

        // Emit status about merging
        let merge_event = SummaryStreamEvent {
            note_id: note_id.clone(),
            chunk: "\nCombining results...\n\n".to_string(),
            is_done: false,
        };
        let _ = app.emit("summary-stream", merge_event);

        // Merge chunk summaries with streaming
        let merge_prompt = match stype {
            SummaryType::Overview => {
                SummaryPrompts::merge_overview(&chunk_summaries, notes.as_deref())
            }
            SummaryType::ActionItems => {
                SummaryPrompts::merge_action_items(&chunk_summaries, notes.as_deref())
            }
            SummaryType::KeyDecisions => {
                SummaryPrompts::merge_key_decisions(&chunk_summaries, notes.as_deref())
            }
            SummaryType::Custom => {
                SummaryPrompts::merge_custom(&chunk_summaries, &user_prompt_str, notes.as_deref())
            }
        };

        // Create channel for streaming the merge
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

        ai_state
            .client
            .generate_stream(&model, &merge_prompt, 0.7, Some(4096), tx)
            .await
            .map_err(|e| e.to_string())?
    } else {
        // Build prompt based on summary type (single pass)
        let prompt = if has_transcript {
            match stype {
                SummaryType::Overview => SummaryPrompts::overview(&transcript, notes.as_deref()),
                SummaryType::ActionItems => {
                    SummaryPrompts::action_items(&transcript, notes.as_deref())
                }
                SummaryType::KeyDecisions => {
                    SummaryPrompts::key_decisions(&transcript, notes.as_deref())
                }
                SummaryType::Custom => {
                    SummaryPrompts::custom(&transcript, &user_prompt_str, notes.as_deref())
                }
            }
        } else {
            // Notes only (no transcript)
            let notes_content = notes.as_ref().unwrap();
            match stype {
                SummaryType::Overview => SummaryPrompts::overview_notes_only(notes_content),
                SummaryType::ActionItems => SummaryPrompts::action_items_notes_only(notes_content),
                SummaryType::KeyDecisions => {
                    SummaryPrompts::key_decisions_notes_only(notes_content)
                }
                SummaryType::Custom => {
                    SummaryPrompts::custom_notes_only(notes_content, &user_prompt_str)
                }
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
        ai_state
            .client
            .generate_stream(&model, &prompt, 0.7, Some(4096), tx)
            .await
            .map_err(|e| e.to_string())?
    };

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

/// Parse one AI checklist line ("- [ ] task @assignee 📅2026-07-11") into
/// (text, assignee, due_date). Returns None for non-task lines.
/// One line of the model's checklist.
#[derive(Debug, PartialEq)]
struct ChecklistItem {
    text: String,
    done: bool,
    due: Option<String>,
}

fn parse_checklist_line(line: &str) -> Option<ChecklistItem> {
    let trimmed = line.trim_start();
    let (rest, done) = [
        ("- [ ] ", false),
        ("* [ ] ", false),
        ("- [x] ", true),
        ("- [X] ", true),
        ("* [x] ", true),
        ("* [X] ", true),
    ]
    .iter()
    .find_map(|(prefix, done)| trimmed.strip_prefix(prefix).map(|rest| (rest, *done)))?;
    let mut text = rest.trim().to_string();

    // 📅YYYY-MM-DD → due date
    let mut due: Option<String> = None;
    if let Some(pos) = text.find('📅') {
        let after = &text[pos + '📅'.len_utf8()..];
        let date: String = after
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '-')
            .collect();
        if date.len() == 10 {
            due = Some(date.clone());
        }
        // Remove the whole "📅 <date>" token.
        let tail = &text[pos..];
        let token: String = tail
            .chars()
            .take_while(|c| *c == '📅' || c.is_whitespace() || c.is_ascii_digit() || *c == '-')
            .collect();
        text = text.replacen(&token, "", 1).trim().to_string();
    }

    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    Some(ChecklistItem { text, done, due })
}

/// Context window requested from Ollama for task extraction.
const EXTRACT_NUM_CTX: usize = 4096;
/// Tokens kept free in every extraction request for the model's answer.
const EXTRACT_OUTPUT_RESERVE: usize = 512;
/// The user's own notes are capped so they can't crowd out the transcript.
const EXTRACT_NOTES_CAP: usize = 1500;

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3000..=0x30FF     // CJK punctuation, Hiragana, Katakana
        | 0x3400..=0x4DBF   // CJK Extension A
        | 0x4E00..=0x9FFF   // CJK Unified Ideographs
        | 0xAC00..=0xD7AF   // Hangul syllables
        | 0xF900..=0xFAFF   // CJK compatibility ideographs
        | 0xFF00..=0xFFEF)  // Fullwidth forms
}

/// A deliberately generous token estimate for budgeting a prompt: a CJK
/// character counts as one token, other text as one token per four bytes.
fn estimate_tokens(text: &str) -> usize {
    let (cjk, other_bytes) = text.chars().fold((0usize, 0usize), |(cjk, other), c| {
        if is_cjk(c) {
            (cjk + 1, other)
        } else {
            (cjk, other + c.len_utf8())
        }
    });
    cjk + other_bytes.div_ceil(4)
}

/// The longest prefix of `text` estimated at no more than `cap` tokens.
fn truncate_to_tokens(text: &str, cap: usize) -> &str {
    let mut cjk = 0usize;
    let mut other = 0usize;
    for (i, c) in text.char_indices() {
        if is_cjk(c) {
            cjk += 1;
        } else {
            other += c.len_utf8();
        }
        if cjk + other.div_ceil(4) > cap {
            return &text[..i];
        }
    }
    text
}

/// Split a transcript into chunks that each fit a token budget, the first
/// chunk under `first_budget` (it also carries the notes) and the rest under
/// `rest_budget`. Splits at sentence ends where it can (including the CJK
/// 。！？, which the summary splitter misses) and mid-sentence only when a
/// sentence alone is over budget.
fn split_by_token_budget(text: &str, first_budget: usize, rest_budget: usize) -> Vec<String> {
    let first_budget = first_budget.max(1);
    let rest_budget = rest_budget.max(1);
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let budget = |chunks: &Vec<String>| if chunks.is_empty() { first_budget } else { rest_budget };

    for sentence in text.split_inclusive(['.', '!', '?', '。', '！', '？']) {
        let mut piece = sentence;
        loop {
            let limit = budget(&chunks);
            if estimate_tokens(&current) + estimate_tokens(piece) <= limit {
                current.push_str(piece);
                break;
            }
            if !current.trim().is_empty() {
                chunks.push(std::mem::take(&mut current).trim().to_string());
                continue;
            }
            // A single sentence over budget: cut it at the budget.
            let head = truncate_to_tokens(piece, limit);
            let head = if head.is_empty() {
                // Always make progress, even past a budget smaller than one character.
                &piece[..piece.chars().next().map_or(0, char::len_utf8)]
            } else {
                head
            };
            chunks.push(head.trim().to_string());
            piece = &piece[head.len()..];
            if piece.is_empty() {
                break;
            }
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks.retain(|c| !c.is_empty());
    chunks
}

/// Task text compared the way a person would: case and spacing don't matter.
fn normalize_task_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// A due date the model gave, if it is a real date on or after the meeting.
fn valid_due_date(due: Option<&str>, meeting_day: Option<chrono::NaiveDate>) -> Option<String> {
    let date = chrono::NaiveDate::parse_from_str(due?, "%Y-%m-%d").ok()?;
    if meeting_day.is_some_and(|day| date < day) {
        return None;
    }
    Some(date.format("%Y-%m-%d").to_string())
}

/// Extract a note's action items with `model` and store the new ones.
///
/// Used to send the whole transcript in one request at num_ctx 2048, so past
/// a few minutes of speech Ollama silently dropped the start of the meeting,
/// and every re-run inserted every item again. Now:
/// - the transcript goes in chunks that each fit a 4096-token context (the
///   notes, capped, ride along with the first);
/// - items already in the note, or already found in an earlier chunk, are
///   skipped, so re-running adds only what is new;
/// - relative dates resolve against the meeting's date, and a due date that
///   isn't a real date on or after the meeting is dropped;
/// - a `- [x]` item is stored as done.
async fn extract_action_items_with(
    client: &OllamaClient,
    model: &str,
    db: &Database,
    note_id: &str,
) -> Result<Vec<ActionItem>, String> {
    let segments = db
        .get_transcript_segments(note_id)
        .map_err(|e| e.to_string())?;
    let transcript = segments
        .iter()
        .map(|s| s.text.clone())
        .filter(|text| !text.contains("[BLANK_AUDIO]"))
        .collect::<Vec<_>>()
        .join(" ");
    let notes = db
        .get_note_description(note_id)
        .map_err(|e| e.to_string())?
        .filter(|n| !n.trim().is_empty());
    let notes = notes.as_deref().map(|n| truncate_to_tokens(n, EXTRACT_NOTES_CAP));

    if transcript.trim().is_empty() && notes.is_none() {
        return Ok(vec![]);
    }

    let meeting_day = db
        .get_note_started_at(note_id)
        .map_err(|e| e.to_string())?
        .and_then(|started| chrono::DateTime::parse_from_rfc3339(&started).ok())
        .map(|started| started.with_timezone(&chrono::Local).date_naive());
    let date_line = meeting_day.map(|day| {
        format!(
            "The meeting took place on {} ({}). Resolve relative dates such as \"Friday\" or \"next week\" against it. Omit 📅 when unsure.",
            day.format("%Y-%m-%d"),
            day.format("%A")
        )
    });

    let template_tokens = estimate_tokens(&SummaryPrompts::action_items_checkboxes(
        "",
        None,
        date_line.as_deref(),
    ));
    let rest_budget = EXTRACT_NUM_CTX
        .saturating_sub(EXTRACT_OUTPUT_RESERVE)
        .saturating_sub(template_tokens);
    let first_budget = rest_budget.saturating_sub(notes.map(estimate_tokens).unwrap_or(0));
    let chunks = if transcript.trim().is_empty() {
        vec![String::new()]
    } else {
        split_by_token_budget(&transcript, first_budget, rest_budget)
    };

    let mut seen: std::collections::HashSet<String> = db
        .get_action_items(note_id)
        .map_err(|e| e.to_string())?
        .iter()
        .map(|item| normalize_task_text(&item.text))
        .collect();

    let mut created = Vec::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let prompt = SummaryPrompts::action_items_checkboxes(
            chunk,
            if i == 0 { notes } else { None },
            date_line.as_deref(),
        );
        let response = client
            .generate(model, &prompt, 0.3, Some(EXTRACT_NUM_CTX as u32))
            .await
            .map_err(|e| e.to_string())?;

        for line in strip_thinking_tags(&response).lines() {
            let Some(item) = parse_checklist_line(line) else {
                continue;
            };
            if !seen.insert(normalize_task_text(&item.text)) {
                continue;
            }
            let due = valid_due_date(item.due.as_deref(), meeting_day);
            let stable_id = Uuid::new_v4().to_string();
            let mut stored = db
                .create_action_item(Some(note_id), &stable_id, &item.text, due.as_deref(), None, None)
                .map_err(|e| e.to_string())?;
            if item.done {
                db.set_action_item_done(stored.id, true)
                    .map_err(|e| e.to_string())?;
                stored.done = true;
            }
            created.push(stored);
        }
    }
    Ok(created)
}

/// #3: Extract action items from a note's transcript + notes and store them as
/// structured rows. Returns the created items.
#[tauri::command]
pub async fn extract_action_items(
    note_id: String,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<Vec<ActionItem>, String> {
    if ai_state.is_extracting.swap(true, Ordering::SeqCst) {
        return Err("Already finding tasks. Please wait for it to finish.".to_string());
    }
    let _guard = scopeguard::guard((), |_| {
        ai_state.is_extracting.store(false, Ordering::SeqCst);
    });

    let model = resolve_model(&ai_state, &db)
        .await
        .ok_or("No model selected. Please select a model first.")?;

    extract_action_items_with(&ai_state.client, &model, &db, &note_id).await
}

/// #3: Get a note's action items.
#[tauri::command]
pub fn get_action_items(
    note_id: String,
    db: State<'_, Database>,
) -> Result<Vec<ActionItem>, String> {
    db.get_action_items(&note_id).map_err(|e| e.to_string())
}

/// #3: Open tasks across all notes (default central Tasks page load).
#[tauri::command]
pub fn get_open_action_items(db: State<'_, Database>) -> Result<Vec<ActionItem>, String> {
    db.get_open_action_items().map_err(|e| e.to_string())
}

/// #3: A page of completed tasks (newest first), loaded lazily.
#[tauri::command]
pub fn get_completed_action_items(
    limit: i64,
    offset: i64,
    db: State<'_, Database>,
) -> Result<Vec<ActionItem>, String> {
    db.get_completed_action_items(limit, offset)
        .map_err(|e| e.to_string())
}

/// #3: Create an action item (top-level, or a subtask when `parent_id` is set).
#[tauri::command]
pub fn create_action_item(
    note_id: Option<String>,
    text: String,
    due_date: Option<String>,
    parent_id: Option<i64>,
    description: Option<String>,
    db: State<'_, Database>,
) -> Result<ActionItem, String> {
    let stable_id = Uuid::new_v4().to_string();
    db.create_action_item(
        note_id.as_deref(),
        &stable_id,
        &text,
        due_date.as_deref(),
        parent_id,
        description.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// #3: Update an action item.
#[tauri::command]
pub fn update_action_item(
    id: i64,
    text: String,
    description: Option<String>,
    due_date: Option<String>,
    done: bool,
    db: State<'_, Database>,
) -> Result<ActionItem, String> {
    db.update_action_item(id, &text, description.as_deref(), due_date.as_deref(), done)
        .map_err(|e| e.to_string())
}

/// #3: Toggle an action item's done flag (used by the global Tasks view).
#[tauri::command]
pub fn set_action_item_done(id: i64, done: bool, db: State<'_, Database>) -> Result<(), String> {
    db.set_action_item_done(id, done).map_err(|e| e.to_string())
}

/// #3: Delete an action item.
#[tauri::command]
pub fn delete_action_item(id: i64, db: State<'_, Database>) -> Result<(), String> {
    db.delete_action_item(id).map_err(|e| e.to_string())
}

/// #3: All open action items across every note, for the global Tasks view.
#[tauri::command]
pub fn list_all_open_action_items(
    db: State<'_, Database>,
) -> Result<Vec<ActionItemWithNote>, String> {
    db.list_all_open_action_items().map_err(|e| e.to_string())
}

/// Generate a title for a note based on its transcript
#[tauri::command]
pub async fn generate_title(
    note_id: String,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<String, String> {
    // Get selected model
    let model = resolve_model(&ai_state, &db)
        .await
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
        format!("{}...", truncate_on_char_boundary(&transcript, 2000))
    } else {
        transcript
    };

    // Build prompt
    let prompt = SummaryPrompts::title(&truncated);

    // Retry logic: try up to 3 times to get a valid title
    let max_retries = 3;
    let mut title = String::new();

    for attempt in 1..=max_retries {
        // Generate with Ollama (low temperature for consistent output)
        let response = ai_state
            .client
            .generate(&model, &prompt, 0.3, Some(100))
            .await
            .map_err(|e| e.to_string())?;

        // Debug: Log raw LLM output
        eprintln!(
            "[DEBUG] Attempt {}/{} - Raw LLM title response:\n{}",
            attempt, max_retries, response
        );

        // Clean up the response - remove thinking tags, quotes, and trim
        title = clean_title_response(&response);

        // Debug: Log cleaned title
        eprintln!(
            "[DEBUG] Attempt {}/{} - Cleaned title: {}",
            attempt, max_retries, title
        );

        // Check if title is valid
        if title != "Meeting Notes" && is_valid_title(&title) {
            break;
        } else if attempt == max_retries {
            title = "Meeting Notes".to_string();
        }
    }

    // Update note title in database and sync incoming links
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Get old title for link updates
        let old_title: Option<String> = conn
            .query_row(
                "SELECT title FROM notes WHERE id = ?1",
                [&note_id],
                |row| row.get(0),
            )
            .ok();

        let now = chrono::Utc::now();
        conn.execute(
            "UPDATE notes SET title = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&title, now.to_rfc3339(), &note_id],
        )
        .map_err(|e| e.to_string())?;

        // Update incoming links if title changed
        if let Some(old) = old_title
            && old != title
        {
            update_incoming_links_internal(&conn, &note_id, &old, &title)?;
        }
    }

    Ok(title)
}

/// Check if a title is valid (not nonsense)
fn is_valid_title(title: &str) -> bool {
    // Must have at least 3 characters
    if title.len() < 3 {
        return false;
    }

    // Must have at least 2 alphabetic characters
    let alpha_count = title.chars().filter(|c| c.is_alphabetic()).count();
    if alpha_count < 2 {
        return false;
    }

    // Check for repeated character patterns (e.g., "aaaa", "abababab")
    let chars: Vec<char> = title.chars().collect();
    if chars.len() >= 4 {
        // Check for same character repeated
        let first = chars[0];
        if chars.iter().all(|&c| c == first) {
            return false;
        }

        // Check for 2-char pattern repeated (e.g., "abab")
        if chars.len() >= 4 && chars.len().is_multiple_of(2) {
            let pattern = &chars[0..2];
            let mut is_repeating = true;
            for i in (0..chars.len()).step_by(2) {
                if chars.get(i..i + 2) != Some(pattern) {
                    is_repeating = false;
                    break;
                }
            }
            if is_repeating && chars.len() > 4 {
                return false;
            }
        }
    }

    // Check for gibberish patterns: too many consonants in a row
    let lower = title.to_lowercase();
    let vowels = ['a', 'e', 'i', 'o', 'u'];
    let mut consonant_streak = 0;
    let mut max_consonant_streak = 0;
    for c in lower.chars() {
        if c.is_alphabetic() {
            if vowels.contains(&c) {
                consonant_streak = 0;
            } else {
                consonant_streak += 1;
                max_consonant_streak = max_consonant_streak.max(consonant_streak);
            }
        } else {
            consonant_streak = 0;
        }
    }
    // More than 6 consonants in a row is likely gibberish (but allow some like "rhythm")
    if max_consonant_streak > 6 {
        return false;
    }

    // Check for mostly punctuation or numbers
    let meaningful_chars = title
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .count();
    if meaningful_chars < title.len() / 2 {
        return false;
    }

    // Check for common nonsense patterns (exact matches)
    let lower_trimmed = lower.trim();
    let nonsense_exact = [
        "lorem ipsum",
        "test title",
        "title here",
        "insert title",
        "placeholder",
        "example",
        "sample",
        "asdf",
        "qwerty",
        "title",
        "summary",
        "transcript",
        "meeting",
        "note",
        "notes",
        "untitled meeting",
        "new meeting",
        "meeting title",
        "the title",
        "a title",
        "discussion",
        "conversation",
        "audio",
        "recording",
        "call",
        "chat",
        "talk",
        "overview",
        "review",
        "update",
        "general",
        "misc",
        "miscellaneous",
        "various",
        "topics",
        "items",
        "agenda",
        "content",
        "text",
        "document",
    ];
    for pattern in nonsense_exact {
        if lower_trimmed == pattern {
            return false;
        }
    }

    // Check for compound generic phrases (contains) - reject if title is ONLY these generic words
    let generic_only_words = ["meeting", "discussion", "summary", "overview", "notes", "update", "review", "call", "conversation", "talk", "general", "team", "weekly", "daily", "monthly"];
    let words: Vec<&str> = lower_trimmed.split_whitespace().collect();
    if !words.is_empty() && words.iter().all(|w| generic_only_words.contains(w)) {
        return false;
    }

    // Check for patterns that might leak from the prompt (contains)
    let prompt_leakage = [
        "2-6 word",
        "2-6word",
        "generate a",
        "just the title",
        "nothing else",
        "word title for",
        "title for this",
        "for this transcript",
        "for this summary",
        "here is",
        "here's a",
        "i would suggest",
        "i suggest",
        "my suggestion",
        "based on the",
        "based on this",
        "title idea",
        "any other",
        "name1",
        "name2",
        "option1",
        "option2",
        "alternative",
        "suggested title",
        "possible title",
        "potential title",
        "description",
        "describe",
        "we need",
        "summary:",
        "main topic",
        "key points",
        "important",
    ];
    for pattern in prompt_leakage {
        if lower_trimmed.contains(pattern) {
            return false;
        }
    }

    true
}

/// Clean up LLM response to extract just the title
fn clean_title_response(response: &str) -> String {
    let cleaned = strip_thinking_tags(response);

    // Take only the first non-empty line (ignore any explanations after)
    let first_line = cleaned
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or(&cleaned)
        .to_string();

    // Remove common prefixes LLMs might add
    let without_prefix = first_line
        .trim_start_matches("Title:")
        .trim_start_matches("title:")
        .trim_start_matches("TITLE:")
        .trim_start_matches("Here's a title:")
        .trim_start_matches("Here is a title:")
        .trim_start_matches("The title is:")
        .trim_start_matches("Suggested title:")
        .trim();

    // Remove surrounding quotes and markdown formatting
    let without_quotes = without_prefix
        .trim_matches('"')
        .trim_matches('\'')
        .trim_matches('`')
        .trim_matches('*')
        .trim_matches('#')
        .trim_matches('_')
        .trim();

    // Detect if LLM returned a question, request, or placeholder instead of a title
    let lower = without_quotes.to_lowercase();
    if lower.contains("can you")
        || lower.contains("could you")
        || lower.contains("please provide")
        || lower.contains("more details")
        || lower.contains("more context")
        || lower.contains("more information")
        || lower.starts_with("i need")
        || lower.starts_with("i would need")
        || lower.starts_with("unfortunately")
        || lower.starts_with("i cannot")
        || lower.starts_with("i'm unable")
        || lower == "unspecified"
        || lower == "untitled"
        || lower == "n/a"
        || lower == "none"
        || lower == "unknown"
        || lower.is_empty()
        || without_quotes.ends_with('?')
    {
        return "Meeting Notes".to_string();
    }

    // Limit length (titles shouldn't be too long)
    let max_len = 100;
    if without_quotes.len() > max_len {
        without_quotes
            .chars()
            .take(max_len)
            .collect::<String>()
            .trim_end()
            .to_string()
    } else {
        without_quotes.to_string()
    }
}

/// Generate a title for a note based on a summary content
#[tauri::command]
pub async fn generate_title_from_summary(
    note_id: String,
    summary_content: String,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<String, String> {
    // Only a note still called "Untitled" gets an AI title. This used to run
    // on every Summarize and every re-recording, replacing titles users had
    // typed, and it fell back to "Meeting Notes" whenever the model's titles
    // failed validation.
    let current_title: String = db
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .query_row("SELECT title FROM notes WHERE id = ?1", [&note_id], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if !is_placeholder_title(&current_title) {
        return Ok(current_title);
    }

    // Get selected model
    let model = resolve_model(&ai_state, &db)
        .await
        .ok_or("No model selected. Please select a model first.")?;

    // Truncate summary if too long
    let truncated = if summary_content.len() > 2000 {
        format!("{}...", truncate_on_char_boundary(&summary_content, 2000))
    } else {
        summary_content
    };

    // Build prompt
    let prompt = SummaryPrompts::title_from_summary(&truncated);

    // Retry logic: try up to 3 times to get a valid title
    let max_retries = 3;
    let mut title = String::new();

    for attempt in 1..=max_retries {
        // Generate with Ollama (low temperature for consistent output)
        let response = ai_state
            .client
            .generate(&model, &prompt, 0.3, Some(100))
            .await
            .map_err(|e| e.to_string())?;

        // Clean up the response
        title = clean_title_response(&response);

        // Check if title is valid
        if title != "Meeting Notes" && is_valid_title(&title) {
            break;
        } else if attempt == max_retries {
            // No usable title: leave the note as it is rather than renaming
            // it to a generic "Meeting Notes".
            return Ok(current_title);
        }
    }

    // Update note title in database and sync incoming links
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Get old title for link updates
        let old_title: Option<String> = conn
            .query_row(
                "SELECT title FROM notes WHERE id = ?1",
                [&note_id],
                |row| row.get(0),
            )
            .ok();

        let now = chrono::Utc::now();
        conn.execute(
            "UPDATE notes SET title = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&title, now.to_rfc3339(), &note_id],
        )
        .map_err(|e| e.to_string())?;

        // Update incoming links if title changed
        if let Some(old) = old_title
            && old != title
        {
            update_incoming_links_internal(&conn, &note_id, &old, &title)?;
        }
    }

    Ok(title)
}

/// Whether a title is the placeholder a new note gets, so it may be replaced.
fn is_placeholder_title(title: &str) -> bool {
    let title = title.trim();
    title.is_empty() || title.eq_ignore_ascii_case("untitled")
}

/// Event payload for streaming AI writing updates
#[derive(Clone, Serialize)]
pub struct AIWriteStreamEvent {
    pub chunk: String,
    pub is_done: bool,
}

/// Generate AI writing assistance with streaming
#[tauri::command]
pub async fn ai_write_stream(
    app: AppHandle,
    content: String,
    action: String,
    note_content: Option<String>,
    ai_state: State<'_, AiState>,
    db: State<'_, Database>,
) -> Result<String, String> {
    // Check if already generating
    if ai_state.is_generating.swap(true, Ordering::SeqCst) {
        return Err("Already generating".to_string());
    }

    // Ensure we reset the flag when done
    let _guard = scopeguard::guard((), |_| {
        ai_state.is_generating.store(false, Ordering::SeqCst);
    });

    // Get selected model
    let model = resolve_model(&ai_state, &db)
        .await
        .ok_or("No model selected. Please select a model first.")?;

    // Build prompt based on action
    let prompt = match action.as_str() {
        "improve" => WritingPrompts::improve(&content),
        "summarize" => WritingPrompts::summarize(&content),
        "expand" => WritingPrompts::expand(&content),
        "fix" => WritingPrompts::fix_grammar(&content),
        "bullets" => WritingPrompts::to_bullets(&content),
        "action_items" => WritingPrompts::extract_action_items(&content),
        "custom" => {
            // For custom, content is the user message, note_content is the note
            let note = note_content.as_deref().unwrap_or("");
            WritingPrompts::custom(note, None, &content)
        }
        _ => return Err(format!("Unknown action: {}", action)),
    };

    // Create channel for streaming
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);
    let app_clone = app.clone();

    // Spawn task to receive chunks and emit events
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let event = AIWriteStreamEvent {
                chunk,
                is_done: false,
            };
            let _ = app_clone.emit("ai-write-stream", event);
        }
    });

    // Generate with Ollama streaming
    let response = ai_state
        .client
        .generate_stream(&model, &prompt, 0.7, Some(4096), tx)
        .await
        .map_err(|e| e.to_string())?;

    // Emit done event
    let done_event = AIWriteStreamEvent {
        chunk: String::new(),
        is_done: true,
    };
    let _ = app.emit("ai-write-stream", done_event);

    // Strip thinking tags from response
    let clean_response = strip_thinking_tags(&response);

    Ok(clean_response)
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
            // The offsets found in `lower` are applied to `result`, so the two
            // must have identical byte layouts. ASCII lowercasing guarantees
            // that; to_lowercase() does not ('İ' grows from 2 bytes to 3).
            let lower = result.to_ascii_lowercase();

            match (lower.find(open_tag), lower.find(close_tag)) {
                // A complete block - remove it, tags included.
                (Some(start), Some(end_pos)) if start < end_pos => {
                    result.replace_range(start..end_pos + close_tag.len(), "");
                }
                // A closing tag with no opening tag before it: the model
                // started mid-thought, so drop everything up to the tag.
                (_, Some(end_pos)) => {
                    result.replace_range(..end_pos + close_tag.len(), "");
                }
                // An unclosed opening tag - everything after it is thinking.
                (Some(start), None) => {
                    result.truncate(start);
                    break;
                }
                (None, None) => break,
            }
        }
    }

    result.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncation_never_splits_a_character() {
        // An em dash (3 bytes) straddling the 2000-byte budget.
        let dash = format!("{}—tail", "a".repeat(1999));
        assert_eq!(truncate_on_char_boundary(&dash, 2000), "a".repeat(1999));

        // 800 CJK characters = 2400 bytes; 2000 is not a multiple of 3.
        let cjk = "会".repeat(800);
        let cut = truncate_on_char_boundary(&cjk, 2000);
        assert_eq!(cut.len(), 1998);
        assert!(cut.chars().all(|c| c == '会'));

        // A 4-byte emoji straddling the budget.
        let emoji = format!("{}🎉🎉", "b".repeat(1998));
        assert_eq!(truncate_on_char_boundary(&emoji, 2000), "b".repeat(1998));

        assert_eq!(truncate_on_char_boundary("short", 2000), "short");
    }

    #[test]
    fn strips_thinking_blocks() {
        assert_eq!(strip_thinking_tags("<think>plan</think>Answer"), "Answer");
        assert_eq!(strip_thinking_tags("<THINKING>x</Thinking> Answer"), "Answer");
        assert_eq!(strip_thinking_tags("halfway thought</think> Answer"), "Answer");
        assert_eq!(strip_thinking_tags("Answer <think>never closed"), "Answer");
        assert_eq!(strip_thinking_tags("No tags here"), "No tags here");
    }

    #[test]
    fn strips_thinking_blocks_around_case_changing_characters() {
        // 'İ' lowercases (Unicode) to 3 bytes; with to_lowercase() offsets
        // the cut landed mid-character and aborted the app.
        assert_eq!(
            strip_thinking_tags("İstanbul <think>plan</think> trip"),
            "İstanbul  trip"
        );
        assert_eq!(strip_thinking_tags("İİİ</think>Answer"), "Answer");
    }

    #[tokio::test]
    async fn the_saved_model_is_used_when_none_was_picked_this_session() {
        let db = Database::in_memory();
        let ai = AiState::default();
        assert_eq!(resolve_model(&ai, &db).await, None);

        db.set_setting(OLLAMA_MODEL_SETTING, "gemma4:latest").unwrap();
        assert_eq!(resolve_model(&ai, &db).await.as_deref(), Some("gemma4:latest"));

        // A model picked this session wins over the saved one.
        *ai.selected_model.lock().await = Some("llama3.2".to_string());
        assert_eq!(resolve_model(&ai, &db).await.as_deref(), Some("llama3.2"));
    }

    #[test]
    fn only_placeholder_titles_are_replaced() {
        assert!(is_placeholder_title("Untitled"));
        assert!(is_placeholder_title("  untitled "));
        assert!(is_placeholder_title(""));
        assert!(!is_placeholder_title("Q3 planning"));
        assert!(!is_placeholder_title("Untitled draft of the roadmap"));
    }

    /// A stand-in for Ollama's /api/generate on a local port. Records every
    /// prompt and answers each with `respond(prompt)`.
    fn fake_ollama(respond: fn(&str) -> String) -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let prompts = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = prompts.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut buf = Vec::new();
                let mut tmp = [0u8; 16384];
                let (body_start, len) = loop {
                    let n = stream.read(&mut tmp).unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..pos]).to_lowercase();
                        let len = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .and_then(|v| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        break (pos + 4, len);
                    }
                };
                while buf.len() < body_start + len {
                    let n = stream.read(&mut tmp).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                }
                let body: serde_json::Value =
                    serde_json::from_slice(&buf[body_start..body_start + len]).unwrap();
                let prompt = body["prompt"].as_str().unwrap_or_default().to_string();
                let json = serde_json::json!({ "response": respond(&prompt), "done": true }).to_string();
                seen.lock().unwrap().push(prompt);
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    json.len(),
                    json
                );
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        (url, prompts)
    }

    /// A note that started at midday UTC on 2026-01-05 (a Monday), so its local
    /// date is the same in every timezone from UTC-11 to UTC+11.
    fn meeting(db: &Database, transcript: &[&str], notes: Option<&str>) {
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO notes (id, title, started_at, created_at, updated_at, description)
                 VALUES ('m1', 'Standup', '2026-01-05T12:00:00Z', '2026-01-05T12:00:00Z', '2026-01-05T12:00:00Z', ?1)",
                [notes],
            )
            .unwrap();
        for (i, text) in transcript.iter().enumerate() {
            let t = i as f64;
            db.add_transcript_segment(&crate::db::models::NewTranscriptSegment::new("m1", t, t + 1.0, *text))
                .unwrap();
        }
    }

    fn prompt_budget() -> usize {
        EXTRACT_NUM_CTX - EXTRACT_OUTPUT_RESERVE
    }

    #[tokio::test]
    async fn long_meetings_are_read_in_chunks_that_fit_the_context() {
        let db = Database::in_memory();
        let mut lines = vec!["Alice will send the pricing deck by Friday."];
        let filler = "We talked through the quarterly roadmap and the hiring plan in detail.";
        lines.extend(std::iter::repeat_n(filler, 560)); // ~40k characters
        meeting(&db, &lines, None);

        let (url, prompts) = fake_ollama(|prompt| {
            if prompt.contains("pricing deck") {
                "- [ ] Send the pricing deck 📅2026-01-09".to_string()
            } else {
                "- [ ] Book the review room".to_string()
            }
        });
        let client = OllamaClient::with_base_url(&url);
        let created = extract_action_items_with(&client, "m", &db, "m1").await.unwrap();

        let prompts = prompts.lock().unwrap();
        assert!(prompts.len() > 1, "a 40k-character transcript went in one request");
        for prompt in prompts.iter() {
            assert!(estimate_tokens(prompt) <= prompt_budget(), "a prompt overflows num_ctx");
        }
        assert!(prompts[0].contains("2026-01-05 (Monday)"), "the prompt lacks the meeting date");

        // The start of the meeting is no longer cut off...
        let deck = created.iter().find(|t| t.text == "Send the pricing deck").unwrap();
        assert_eq!(deck.due_date.as_deref(), Some("2026-01-09"));
        // ...and an item found in several chunks is stored once.
        assert_eq!(created.iter().filter(|t| t.text == "Book the review room").count(), 1);
    }

    #[tokio::test]
    async fn chinese_meetings_are_chunked_by_characters() {
        let db = Database::in_memory();
        let sentence = "我们讨论了下个季度的产品路线图和招聘计划。"; // 21 CJK characters
        let transcript: Vec<&str> = std::iter::repeat_n(sentence, 950).collect(); // ~20k characters
        let notes = "会议记录".repeat(750); // 3k characters, over the notes cap
        meeting(&db, &transcript, Some(&notes));

        let (url, prompts) = fake_ollama(|_| String::new());
        let client = OllamaClient::with_base_url(&url);
        extract_action_items_with(&client, "m", &db, "m1").await.unwrap();

        let prompts = prompts.lock().unwrap();
        assert!(prompts.len() > 1);
        for prompt in prompts.iter() {
            assert!(estimate_tokens(prompt) <= prompt_budget(), "a CJK prompt overflows num_ctx");
        }
        // The notes ride with the first chunk only.
        assert!(prompts[0].contains("会议记录"));
        assert!(prompts[1..].iter().all(|p| !p.contains("会议记录")));
    }

    #[tokio::test]
    async fn running_generate_again_adds_nothing_new() {
        let db = Database::in_memory();
        meeting(&db, &["Bob will ping legal about the contract."], None);
        let (url, _) = fake_ollama(|_| "- [ ] Ping legal about the contract".to_string());
        let client = OllamaClient::with_base_url(&url);

        assert_eq!(extract_action_items_with(&client, "m", &db, "m1").await.unwrap().len(), 1);
        assert!(extract_action_items_with(&client, "m", &db, "m1").await.unwrap().is_empty());
        assert_eq!(db.get_action_items("m1").unwrap().len(), 1);
    }

    #[tokio::test]
    async fn done_items_and_impossible_dates_are_handled() {
        let db = Database::in_memory();
        meeting(&db, &["Some things were decided."], None);
        let (url, _) = fake_ollama(|_| {
            "- [x] Ping legal\n- [ ] Ship v2 📅2023-01-01\n- [ ] Plan the offsite 📅2026-02-30\nNot a task"
                .to_string()
        });
        let client = OllamaClient::with_base_url(&url);
        let created = extract_action_items_with(&client, "m", &db, "m1").await.unwrap();

        let by_text = |text: &str| created.iter().find(|t| t.text == text).unwrap();
        assert!(by_text("Ping legal").done);
        assert_eq!(by_text("Ship v2").due_date, None, "a date before the meeting was kept");
        assert_eq!(by_text("Plan the offsite").due_date, None, "Feb 30 was kept");
        assert_eq!(created.len(), 3);
    }

    #[test]
    fn token_budget_splitting_keeps_every_word() {
        let text = "One two three. Four five six! Seven eight nine? Ten. ".repeat(200);
        let chunks = split_by_token_budget(&text, 40, 60);
        assert!(estimate_tokens(&chunks[0]) <= 40);
        assert!(chunks[1..].iter().all(|c| estimate_tokens(c) <= 60));
        let words = |s: &str| s.split_whitespace().map(str::to_string).collect::<Vec<_>>().join(" ");
        assert_eq!(words(&chunks.join(" ")), words(&text));
    }

    #[test]
    fn close_tag_before_open_tag_terminates() {
        // Used to splice the text into itself and loop forever.
        assert_eq!(
            strip_thinking_tags("</think> Answer <think>more thinking"),
            "Answer"
        );
    }
}
