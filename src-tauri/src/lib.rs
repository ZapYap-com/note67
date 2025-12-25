mod commands;
mod db;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::create_meeting,
            commands::get_meeting,
            commands::list_meetings,
            commands::end_meeting,
            commands::delete_meeting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
