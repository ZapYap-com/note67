use tauri::State;

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
