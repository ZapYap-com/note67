mod ai;
mod audio;
mod commands;
mod db;
mod transcription;

use commands::{init_transcription_state, AiState, AudioState};
use db::Database;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Note67.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let db = Database::new(app.handle())?;
            app.manage(db);
            app.manage(AudioState::default());
            app.manage(AiState::default());
            let transcription_state = init_transcription_state(app.handle());
            app.manage(transcription_state);

            // Setup system tray menu
            let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
            let new_meeting = MenuItem::with_id(app, "new_meeting", "New Meeting", true, None::<&str>)?;
            let separator = MenuItem::with_id(app, "sep", "─────────", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Note67", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_hide, &new_meeting, &separator, &quit])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "new_meeting" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("tray-new-meeting", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

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
            // Settings commands
            commands::get_theme_preference,
            commands::set_theme_preference,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
