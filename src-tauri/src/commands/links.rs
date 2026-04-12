use chrono::Utc;
use regex::Regex;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::Database;

#[derive(Debug, Serialize)]
pub struct NoteLink {
    pub id: i64,
    pub source_note_id: String,
    pub target_note_id: Option<String>,
    pub target_title: String,
}

#[derive(Debug, Serialize)]
pub struct BacklinkNote {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub started_at: String,
}

/// Extract wiki links from content using regex
/// Matches [[Note Title]] pattern
pub fn extract_links(content: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect()
}

/// Internal function to sync note links - can be called from other modules
pub fn sync_note_links_internal(
    conn: &rusqlite::Connection,
    note_id: &str,
    content: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();

    // Extract links from content
    let link_titles = extract_links(content);

    // Delete existing links for this note
    conn.execute(
        "DELETE FROM note_links WHERE source_note_id = ?1",
        [note_id],
    )
    .map_err(|e| e.to_string())?;

    // Insert new links
    for title in link_titles {
        // Try to find a note with matching title (case-insensitive)
        let target_note_id: Option<String> = conn
            .query_row(
                "SELECT id FROM notes WHERE LOWER(title) = LOWER(?1) LIMIT 1",
                [&title],
                |row| row.get(0),
            )
            .ok();

        conn.execute(
            "INSERT INTO note_links (source_note_id, target_note_id, target_title, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![note_id, target_note_id, title, now],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Get backlinks - notes that link TO this note
#[tauri::command]
pub fn get_backlinks(db: State<Database>, note_id: String) -> Result<Vec<BacklinkNote>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT n.id, n.title, n.description, n.started_at
             FROM notes n
             INNER JOIN note_links nl ON n.id = nl.source_note_id
             WHERE nl.target_note_id = ?1
             ORDER BY n.started_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([&note_id], |row| {
            Ok(BacklinkNote {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                started_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(notes)
}

/// Get links FROM this note
#[tauri::command]
pub fn get_note_links(db: State<Database>, note_id: String) -> Result<Vec<NoteLink>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, source_note_id, target_note_id, target_title
             FROM note_links
             WHERE source_note_id = ?1
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let links = stmt
        .query_map([&note_id], |row| {
            Ok(NoteLink {
                id: row.get(0)?,
                source_note_id: row.get(1)?,
                target_note_id: row.get(2)?,
                target_title: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(links)
}

/// Search notes by title for autocomplete
#[tauri::command]
pub fn search_notes_by_title(
    db: State<Database>,
    query: String,
) -> Result<Vec<BacklinkNote>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Use LIKE for prefix matching
    let search_pattern = format!("{}%", query.to_lowercase());

    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, started_at
             FROM notes
             WHERE LOWER(title) LIKE ?1
             ORDER BY started_at DESC
             LIMIT 10",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([&search_pattern], |row| {
            Ok(BacklinkNote {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                started_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_links() {
        let content = "This is a note with [[Note A]] and [[Note B]] links";
        let links = extract_links(content);
        assert_eq!(links.len(), 2);
        assert!(links.contains(&"Note A".to_string()));
        assert!(links.contains(&"Note B".to_string()));
    }

    #[test]
    fn test_extract_links_duplicate() {
        let content = "Link to [[Note A]] and again [[Note A]]";
        let links = extract_links(content);
        assert_eq!(links.len(), 1);
        assert!(links.contains(&"Note A".to_string()));
    }

    #[test]
    fn test_extract_links_empty() {
        let content = "No links here";
        let links = extract_links(content);
        assert!(links.is_empty());
    }

    #[test]
    fn test_extract_links_nested_brackets() {
        let content = "Invalid [[nested [[bracket]]]] pattern";
        let links = extract_links(content);
        // Should match "nested [[bracket" which is imperfect but acceptable
        assert_eq!(links.len(), 1);
    }
}
