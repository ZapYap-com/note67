use chrono::Utc;
use regex::Regex;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::Database;

#[derive(Debug, Serialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub note_count: i64,
}

#[derive(Debug, Serialize)]
pub struct NoteTag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

/// Extract hashtags from content using regex
/// Matches #tag where tag starts with a letter and can contain letters, numbers, underscores, and hyphens
pub fn extract_tags(content: &str) -> Vec<String> {
    let re = Regex::new(r"#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap();
    re.captures_iter(content)
        .map(|cap| cap[1].to_lowercase())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect()
}

/// Internal function to sync note tags - can be called from other modules
pub fn sync_note_tags_internal(
    conn: &rusqlite::Connection,
    note_id: &str,
    content: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();

    // Extract tags from content
    let tag_names = extract_tags(content);

    // Get current tags for this note
    let mut current_stmt = conn
        .prepare(
            "SELECT t.name FROM tags t
             INNER JOIN note_tags nt ON t.id = nt.tag_id
             WHERE nt.note_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let current_tags: Vec<String> = current_stmt
        .query_map([note_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Tags to add (in new content but not in current)
    let tags_to_add: Vec<&String> = tag_names
        .iter()
        .filter(|t| !current_tags.contains(t))
        .collect();

    // Tags to remove (in current but not in new content)
    let tags_to_remove: Vec<&String> = current_tags
        .iter()
        .filter(|t| !tag_names.contains(t))
        .collect();

    // Add new tags
    for tag_name in tags_to_add {
        // Insert tag if it doesn't exist
        conn.execute(
            "INSERT OR IGNORE INTO tags (name, created_at) VALUES (?1, ?2)",
            params![tag_name, now],
        )
        .map_err(|e| e.to_string())?;

        // Get tag id
        let tag_id: i64 = conn
            .query_row("SELECT id FROM tags WHERE name = ?1", [tag_name], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        // Link tag to note
        conn.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
            params![note_id, tag_id, now],
        )
        .map_err(|e| e.to_string())?;
    }

    // Remove old tags
    for tag_name in tags_to_remove {
        // Get tag id
        if let Ok(tag_id) = conn.query_row::<i64, _, _>(
            "SELECT id FROM tags WHERE name = ?1",
            [tag_name],
            |row| row.get(0),
        ) {
            // Remove link
            conn.execute(
                "DELETE FROM note_tags WHERE note_id = ?1 AND tag_id = ?2",
                params![note_id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Get all tags with note counts
#[tauri::command]
pub fn get_all_tags(db: State<Database>) -> Result<Vec<Tag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color, COUNT(nt.note_id) as note_count
             FROM tags t
             LEFT JOIN note_tags nt ON t.id = nt.tag_id
             GROUP BY t.id
             ORDER BY note_count DESC, t.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                note_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// Get tags for a specific note
#[tauri::command]
pub fn get_note_tags(db: State<Database>, note_id: String) -> Result<Vec<NoteTag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color
             FROM tags t
             INNER JOIN note_tags nt ON t.id = nt.tag_id
             WHERE nt.note_id = ?1
             ORDER BY t.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([&note_id], |row| {
            Ok(NoteTag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// Sync note tags based on content - extracts #tags from content and updates database
#[tauri::command]
pub fn sync_note_tags(db: State<Database>, note_id: String, content: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    sync_note_tags_internal(&conn, &note_id, &content)
}

/// Get notes filtered by tag name
#[tauri::command]
pub fn get_notes_by_tag(
    db: State<Database>,
    tag_name: String,
) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title, n.description, n.participants, n.started_at, n.ended_at,
                    n.audio_path, n.created_at, n.updated_at
             FROM notes n
             INNER JOIN note_tags nt ON n.id = nt.note_id
             INNER JOIN tags t ON nt.tag_id = t.id
             WHERE LOWER(t.name) = LOWER(?1)
             ORDER BY n.started_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([&tag_name], |row| {
            Ok(crate::db::models::Note {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                participants: row.get(3)?,
                started_at: parse_datetime(row.get::<_, String>(4)?),
                ended_at: row.get::<_, Option<String>>(5)?.map(parse_datetime),
                audio_path: row.get(6)?,
                created_at: parse_datetime(row.get::<_, String>(7)?),
                updated_at: parse_datetime(row.get::<_, String>(8)?),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(notes)
}

/// Get all note-tag mappings (for displaying inline tags efficiently)
#[tauri::command]
pub fn get_all_note_tags(db: State<Database>) -> Result<std::collections::HashMap<String, Vec<NoteTag>>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT nt.note_id, t.id, t.name, t.color
             FROM note_tags nt
             INNER JOIN tags t ON nt.tag_id = t.id
             ORDER BY nt.note_id, t.name",
        )
        .map_err(|e| e.to_string())?;

    let mut result: std::collections::HashMap<String, Vec<NoteTag>> = std::collections::HashMap::new();

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                NoteTag {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        if let Ok((note_id, tag)) = row {
            result.entry(note_id).or_default().push(tag);
        }
    }

    Ok(result)
}

/// Delete a tag globally (removes from all notes)
#[tauri::command]
pub fn delete_tag(db: State<Database>, tag_id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Delete tag associations first (handled by CASCADE but explicit is clearer)
    conn.execute("DELETE FROM note_tags WHERE tag_id = ?1", [tag_id])
        .map_err(|e| e.to_string())?;

    // Delete the tag itself
    conn.execute("DELETE FROM tags WHERE id = ?1", [tag_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn parse_datetime(s: String) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tags() {
        let content = "This is a note with #tag1 and #tag2 and #Tag1 duplicate";
        let tags = extract_tags(content);
        assert_eq!(tags.len(), 2);
        assert!(tags.contains(&"tag1".to_string()));
        assert!(tags.contains(&"tag2".to_string()));
    }

    #[test]
    fn test_extract_tags_with_special_chars() {
        let content = "Note with #my-tag and #another_tag and #tag123";
        let tags = extract_tags(content);
        assert_eq!(tags.len(), 3);
        assert!(tags.contains(&"my-tag".to_string()));
        assert!(tags.contains(&"another_tag".to_string()));
        assert!(tags.contains(&"tag123".to_string()));
    }

    #[test]
    fn test_extract_tags_invalid() {
        let content = "Invalid tags: #123start #-invalid # empty";
        let tags = extract_tags(content);
        assert!(tags.is_empty());
    }
}
