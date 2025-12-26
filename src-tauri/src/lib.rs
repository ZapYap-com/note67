mod ai;
mod audio;
mod commands;
mod db;
mod transcription;

use commands::{init_transcription_state, AiState, AudioState};
use db::Database;
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WindowEvent,
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

            // Create custom application menu (macOS) with Hide instead of Quit on Cmd+Q
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::PredefinedMenuItem;

                let hide_window = MenuItem::with_id(app, "hide_window", "Hide Window", true, Some("CmdOrCtrl+Q"))?;
                let quit = MenuItem::with_id(app, "quit_app", "Quit Note67", true, Some("CmdOrCtrl+Shift+Q"))?;

                let app_submenu = SubmenuBuilder::new(app, "Note67")
                    .item(&PredefinedMenuItem::about(app, Some("About Note67"), None)?)
                    .separator()
                    .item(&hide_window)
                    .item(&quit)
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .item(&PredefinedMenuItem::undo(app, None)?)
                    .item(&PredefinedMenuItem::redo(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::cut(app, None)?)
                    .item(&PredefinedMenuItem::copy(app, None)?)
                    .item(&PredefinedMenuItem::paste(app, None)?)
                    .item(&PredefinedMenuItem::select_all(app, None)?)
                    .build()?;

                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .item(&PredefinedMenuItem::minimize(app, None)?)
                    .item(&PredefinedMenuItem::maximize(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::close_window(app, None)?)
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(&edit_submenu)
                    .item(&window_submenu)
                    .build()?;

                app.set_menu(menu)?;

                // Handle custom menu events
                app.on_menu_event(move |app_handle, event| {
                    match event.id().as_ref() {
                        "hide_window" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit_app" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                });
            }

            // Setup system tray menu
            let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let new_meeting = MenuItem::with_id(app, "new_meeting", "New Meeting", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open, &new_meeting, &settings, &exit])?;

            let icon = Image::from_path("icons/icon.png").unwrap_or_else(|_| {
                app.default_window_icon().unwrap().clone()
            });

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "new_meeting" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("tray-new-meeting", ());
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("tray-open-settings", ());
                        }
                    }
                    "exit" => {
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window instead of closing when user clicks the close button
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
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
            commands::is_system_audio_supported,
            commands::has_system_audio_permission,
            commands::request_system_audio_permission,
            commands::start_dual_recording,
            commands::stop_dual_recording,
            commands::is_dual_recording,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Prevent app from exiting when Cmd+Q is pressed (hide window instead)
            if let RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
                // Hide all windows
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        });
}
