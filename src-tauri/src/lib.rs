mod ai;
mod audio;
mod commands;
mod db;
mod transcription;

use commands::{init_transcription_state, AiState, AudioState};
use db::Database;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Note67.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let db = Database::new(app.handle())?;
            app.manage(db);
            app.manage(AudioState::default());
            app.manage(AiState::default());
            let transcription_state = init_transcription_state(app.handle());
            app.manage(transcription_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::create_meeting,
            commands::get_meeting,
            commands::list_meetings,
            commands::end_meeting,
            commands::delete_meeting,
            commands::update_meeting,
            commands::search_meetings,
            commands::start_recording,
            commands::stop_recording,
            commands::get_recording_status,
            commands::get_audio_level,
            commands::list_models,
            commands::download_model,
            commands::get_download_progress,
            commands::is_downloading,
            commands::delete_model,
            commands::load_model,
            commands::get_loaded_model,
            commands::transcribe_audio,
            commands::is_transcribing,
            commands::get_transcript,
            commands::add_transcript_segment,
            commands::start_live_transcription,
            commands::stop_live_transcription,
            commands::is_live_transcribing,
            // AI commands
            commands::get_ollama_status,
            commands::list_ollama_models,
            commands::select_ollama_model,
            commands::get_selected_model,
            commands::is_ai_generating,
            commands::generate_summary,
            commands::generate_summary_stream,
            commands::get_meeting_summaries,
            commands::delete_summary,
            commands::generate_title,
            commands::generate_title_from_summary,
            // Export commands
            commands::export_meeting_markdown,
            commands::save_export_to_file,
            commands::get_export_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
