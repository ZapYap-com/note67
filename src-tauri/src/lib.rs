mod audio;
mod commands;
mod db;

use commands::AudioState;
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
        .setup(|app| {
            let db = Database::new(app.handle())?;
            app.manage(db);
            app.manage(AudioState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::create_meeting,
            commands::get_meeting,
            commands::list_meetings,
            commands::end_meeting,
            commands::delete_meeting,
            commands::start_recording,
            commands::stop_recording,
            commands::get_recording_status,
            commands::get_audio_level,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
