use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::db::Database;

/// Open the macOS Screen Recording privacy settings
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    Err("Screen recording settings are only available on macOS".to_string())
}

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

/// Get a setting value by key
#[tauri::command]
pub fn get_setting(key: String, db: State<'_, Database>) -> Result<Option<String>, String> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

/// Set a setting value by key
#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, Database>) -> Result<(), String> {
    db.set_setting(&key, &value).map_err(|e| e.to_string())
}

/// Get multiple settings at once
#[tauri::command]
pub fn get_settings(keys: Vec<String>, db: State<'_, Database>) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    let mut result = std::collections::HashMap::new();
    for key in keys {
        let value = db.get_setting(&key).map_err(|e| e.to_string())?;
        result.insert(key, value);
    }
    Ok(result)
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
