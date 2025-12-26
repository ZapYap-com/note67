use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::db::Database;

/// Get the theme preference from settings
#[tauri::command]
pub fn get_theme_preference(db: State<'_, Database>) -> Result<String, String> {
    db.get_setting("theme")
        .map_err(|e| e.to_string())
        .map(|opt| opt.unwrap_or_else(|| "system".to_string()))
}

/// Set the theme preference in settings
#[tauri::command]
pub fn set_theme_preference(theme: String, db: State<'_, Database>) -> Result<(), String> {
    // Validate theme value
    if !["light", "dark", "system"].contains(&theme.as_str()) {
        return Err(format!("Invalid theme value: {}", theme));
    }
    db.set_setting("theme", &theme).map_err(|e| e.to_string())
}

/// Get the autostart status
#[tauri::command]
pub fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    let manager = app.autolaunch();
    manager.is_enabled().map_err(|e: tauri_plugin_autostart::Error| e.to_string())
}

/// Enable or disable autostart
#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e: tauri_plugin_autostart::Error| e.to_string())
    } else {
        manager.disable().map_err(|e: tauri_plugin_autostart::Error| e.to_string())
    }
}
