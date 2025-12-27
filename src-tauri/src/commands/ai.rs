use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::ai::prompts::MAX_CONTENT_LENGTH;
use crate::ai::{OllamaClient, OllamaModel, SummaryPrompts};
use crate::db::models::{Summary, SummaryType};
use crate::db::Database;

/// Split text into chunks of approximately max_size characters
/// Tries to split on sentence boundaries when possible
fn split_into_chunks(text: &str, max_size: usize) -> Vec<String> {
    if text.len() <= max_size {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current_chunk = String::new();

    // Split by sentences (rough approximation)
    for sentence in text.split_inclusive(|c| c == '.' || c == '!' || c == '?') {
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
            eprintln!("[DEBUG] Title accepted: {}", title);
            break;
        } else {
            eprintln!(
                "[DEBUG] Title rejected (invalid or fallback), {}",
                if attempt < max_retries {
                    "retrying..."
                } else {
                    "using fallback"
                }
            );
            if attempt == max_retries {
                title = "Meeting Notes".to_string();
            }
        }
    }

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
        if chars.len() >= 4 && chars.len() % 2 == 0 {
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
    ];
    for pattern in nonsense_exact {
        if lower_trimmed == pattern {
            return false;
        }
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
            "[DEBUG] title_from_summary Attempt {}/{} - Raw response:\n{}",
            attempt, max_retries, response
        );

        // Clean up the response
        title = clean_title_response(&response);

        // Debug: Log cleaned title
        eprintln!(
            "[DEBUG] title_from_summary Attempt {}/{} - Cleaned: {}",
            attempt, max_retries, title
        );

        // Check if title is valid
        if title != "Meeting Notes" && is_valid_title(&title) {
            eprintln!("[DEBUG] Title accepted: {}", title);
            break;
        } else {
            eprintln!(
                "[DEBUG] Title rejected, {}",
                if attempt < max_retries {
                    "retrying..."
                } else {
                    "using fallback"
                }
            );
            if attempt == max_retries {
                title = "Meeting Notes".to_string();
            }
        }
    }

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
