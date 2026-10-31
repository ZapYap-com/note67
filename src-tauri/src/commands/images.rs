use tauri::Manager;
use uuid::Uuid;

use crate::paths::validate_note_id;

/// Image types the editor shows. The extension comes from the pasted or
/// dropped file's name, and the file lands in a folder the webview can load,
/// so nothing else (.plist, .html, .svg) is written.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

/// Save an image to the attachments folder and return the asset URL
#[tauri::command]
pub async fn save_image(
    app_handle: tauri::AppHandle,
    note_id: String,
    image_data: Vec<u8>,
    filename: String,
) -> Result<String, String> {
    validate_note_id(&note_id)?;

    // Get app data directory
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Generate unique filename with original extension
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_else(|| "png".to_string());
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Unsupported image type: .{}", extension));
    }

    // Create attachments/{note_id}/ folder
    let attachments_dir = app_data.join("attachments").join(&note_id);
    std::fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("Failed to create attachments dir: {}", e))?;
    let unique_filename = format!("{}.{}", Uuid::new_v4(), extension);
    let file_path = attachments_dir.join(&unique_filename);

    // Save image file
    std::fs::write(&file_path, &image_data)
        .map_err(|e| format!("Failed to save image: {}", e))?;

    // Return the file path as a string (frontend will convert to asset URL)
    Ok(file_path.to_string_lossy().to_string())
}

/// Delete all attachments for a note (called when note is deleted)
#[tauri::command]
pub async fn delete_note_attachments(
    app_handle: tauri::AppHandle,
    note_id: String,
) -> Result<(), String> {
    validate_note_id(&note_id)?;

    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let attachments_dir = app_data.join("attachments").join(&note_id);

    if attachments_dir.exists() {
        std::fs::remove_dir_all(&attachments_dir)
            .map_err(|e| format!("Failed to delete attachments: {}", e))?;
    }

    Ok(())
}

