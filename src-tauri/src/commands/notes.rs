use std::path::PathBuf;

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::audio::converter::get_audio_duration_ms;
use crate::commands::links::{sync_note_links_internal, update_incoming_links_internal};
use crate::commands::tags::sync_note_tags_internal;
use crate::db::models::{AudioSegment, NewNote, Note, UpdateNote};
use crate::db::Database;

#[tauri::command]
pub fn create_note(
    app_handle: AppHandle,
    db: State<Database>,
    input: NewNote,
) -> Result<Note, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO notes (id, title, description, participants, started_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            &id,
            &input.title,
            &input.description,
            &input.participants,
            now.to_rfc3339(),
            now.to_rfc3339(),
            now.to_rfc3339(),
        ),
    )
    .map_err(|e| e.to_string())?;

    // Sync tags and links if description was provided
    if let Some(ref description) = input.description {
        sync_note_tags_internal(&conn, &id, description)?;
        sync_note_links_internal(&conn, &id, description)?;
    }

    // Emit event for real-time updates
    let _ = app_handle.emit("note-created", &id);

    Ok(Note {
        id,
        title: input.title,
        description: input.description,
        participants: input.participants,
        started_at: now,
        ended_at: None,
        audio_path: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_note(db: State<Database>, id: String) -> Result<Option<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let result = conn.query_row(
        "SELECT id, title, description, participants, started_at, ended_at, audio_path, created_at, updated_at
         FROM notes WHERE id = ?1",
        [&id],
        |row| {
            Ok(Note {
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
        },
    );

    match result {
        Ok(note) => Ok(Some(note)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn list_notes(db: State<Database>) -> Result<Vec<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, participants, started_at, ended_at, audio_path, created_at, updated_at
             FROM notes ORDER BY started_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([], |row| {
            Ok(Note {
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
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}

#[tauri::command]
pub fn update_note(
    app_handle: AppHandle,
    db: State<Database>,
    id: String,
    update: UpdateNote,
) -> Result<Note, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();

    // Get old title if we're updating the title (for link updates)
    let old_title: Option<String> = if update.title.is_some() {
        conn.query_row(
            "SELECT title FROM notes WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .ok()
    } else {
        None
    };

    // Build dynamic update query
    let mut updates = vec!["updated_at = ?1"];
    let mut param_idx = 2;

    if update.title.is_some() {
        updates.push("title = ?2");
        param_idx = 3;
    }
    if update.description.is_some() {
        updates.push(if param_idx == 2 {
            "description = ?2"
        } else {
            "description = ?3"
        });
        param_idx += 1;
    }
    if update.participants.is_some() {
        updates.push(match param_idx {
            2 => "participants = ?2",
            3 => "participants = ?3",
            _ => "participants = ?4",
        });
    }

    let sql = format!(
        "UPDATE notes SET {} WHERE id = ?{}",
        updates.join(", "),
        param_idx
    );

    // Execute with the right number of params
    match (
        update.title.as_ref(),
        update.description.as_ref(),
        update.participants.as_ref(),
    ) {
        (Some(t), Some(d), Some(p)) => {
            conn.execute(&sql, rusqlite::params![now.to_rfc3339(), t, d, p, id])
        }
        (Some(t), Some(d), None) => {
            conn.execute(&sql, rusqlite::params![now.to_rfc3339(), t, d, id])
        }
        (Some(t), None, Some(p)) => {
            conn.execute(&sql, rusqlite::params![now.to_rfc3339(), t, p, id])
        }
        (Some(t), None, None) => conn.execute(&sql, rusqlite::params![now.to_rfc3339(), t, id]),
        (None, Some(d), Some(p)) => {
            conn.execute(&sql, rusqlite::params![now.to_rfc3339(), d, p, id])
        }
        (None, Some(d), None) => conn.execute(&sql, rusqlite::params![now.to_rfc3339(), d, id]),
        (None, None, Some(p)) => conn.execute(&sql, rusqlite::params![now.to_rfc3339(), p, id]),
        (None, None, None) => conn.execute(&sql, rusqlite::params![now.to_rfc3339(), id]),
    }
    .map_err(|e| e.to_string())?;

    // Sync tags and links if description was updated
    let links_changed = update.description.is_some();
    if let Some(ref description) = update.description {
        sync_note_tags_internal(&conn, &id, description)?;
        sync_note_links_internal(&conn, &id, description)?;
    }

    // Update incoming links if title changed
    if let (Some(old), Some(new)) = (old_title, update.title.as_ref())
        && &old != new
    {
        update_incoming_links_internal(&conn, &id, &old, new)?;
    }

    // Emit events for real-time updates
    let _ = app_handle.emit("note-updated", &id);
    if links_changed {
        let _ = app_handle.emit("note-links-changed", &id);
    }

    // Return updated note
    drop(conn);
    get_note(db, id)?.ok_or_else(|| "Note not found".to_string())
}

#[tauri::command]
pub fn search_notes(db: State<Database>, query: String) -> Result<Vec<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    search_notes_fts(&conn, &query).map_err(|e| e.to_string())
}

/// Turn what the user typed into an FTS5 query that cannot be a syntax error.
///
/// The raw text used to go straight into MATCH, where `-`, `'`, `.`, `+`,
/// `#`, `:`, parentheses, an unbalanced quote or a bare AND/OR/NOT are all
/// query syntax. Ordinary searches like "q3-planning", "don't" or "C++" failed,
/// the error was swallowed, and the modal said "No notes found". Each word is
/// now quoted as a literal (inner quotes doubled), and the last one also
/// matches as a prefix so results keep up while the user is typing.
fn fts_query(input: &str) -> Option<String> {
    let words: Vec<String> = input
        .split_whitespace()
        .map(|word| format!("\"{}\"", word.replace('"', "\"\"")))
        .collect();
    if words.is_empty() {
        return None;
    }
    Some(format!("{}*", words.join(" ")))
}

fn search_notes_fts(conn: &rusqlite::Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let Some(search_query) = fts_query(query) else {
        return Ok(Vec::new());
    };

    let mut stmt = conn.prepare(
        "SELECT m.id, m.title, m.description, m.participants, m.started_at, m.ended_at,
                m.audio_path, m.created_at, m.updated_at
         FROM notes m
         JOIN notes_fts fts ON m.rowid = fts.rowid
         WHERE notes_fts MATCH ?1
         ORDER BY m.started_at DESC
         LIMIT 50",
    )?;

    stmt.query_map([&search_query], |row| {
        Ok(Note {
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
    })?
    // A bad row is an error to report, not a result to drop silently.
    .collect()
}

#[tauri::command]
pub fn end_note(
    db: State<Database>,
    id: String,
    audio_path: Option<String>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();

    conn.execute(
        "UPDATE notes SET ended_at = ?1, updated_at = ?2, audio_path = ?3 WHERE id = ?4",
        (now.to_rfc3339(), now.to_rfc3339(), &audio_path, &id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_note(
    app_handle: AppHandle,
    db: State<Database>,
    id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // First, get the audio path before deleting
    let audio_path: Option<String> = conn
        .query_row(
            "SELECT audio_path FROM notes WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .ok();

    // Delete the note record
    conn.execute("DELETE FROM notes WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    // Delete the audio file if it exists
    if let Some(path) = audio_path
        && !path.is_empty()
        && let Err(e) = std::fs::remove_file(&path)
    {
        eprintln!("Failed to delete audio file {}: {}", path, e);
    }

    // Emit event for real-time updates
    let _ = app_handle.emit("note-deleted", &id);

    Ok(())
}

fn parse_datetime(s: String) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// ========== Pause/Resume/Continue Recording Support ==========

/// Get all audio segments for a note
#[tauri::command]
pub fn get_note_audio_segments(db: State<Database>, note_id: String) -> Result<Vec<AudioSegment>, String> {
    db.get_audio_segments(&note_id).map_err(|e| e.to_string())
}

/// Migrate legacy audio_path to audio_segments table.
/// This is called when opening a note that has audio_path but no segments.
/// Returns the created segment if migration occurred, None if no migration needed.
#[tauri::command]
pub fn migrate_legacy_audio(
    db: State<Database>,
    note_id: String,
) -> Result<Option<AudioSegment>, String> {
    // First check if migration is needed by getting note info
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let audio_path: Option<String> = conn
        .query_row(
            "SELECT audio_path FROM notes WHERE id = ?1",
            [&note_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    drop(conn); // Release lock before calling migrate

    // Get duration from the audio file if it exists
    let duration_ms = audio_path
        .as_ref()
        .and_then(|path| {
            if path.is_empty() {
                None
            } else {
                get_audio_duration_ms(&PathBuf::from(path)).ok()
            }
        });

    db.migrate_legacy_audio(&note_id, duration_ms)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notebook() -> Database {
        let db = Database::in_memory();
        {
            let conn = db.conn.lock().unwrap();
            for (id, title, body) in [
                ("n1", "Q3 planning", "Agenda for q3-planning with the team"),
                ("n2", "Retro", "We don't ship on Fridays. Release v1.2 next."),
                ("n3", "Interview", "Strong C++ background, email sam@example.com"),
                ("n4", "Design sync", "Discussed #design tokens (colors: warm)"),
            ] {
                conn.execute(
                    "INSERT INTO notes (id, title, started_at, created_at, updated_at, description)
                     VALUES (?1, ?2, '2026-01-01', '2026-01-01', '2026-01-01', ?3)",
                    [id, title, body],
                )
                .unwrap();
            }
        }
        db
    }

    fn ids(db: &Database, query: &str) -> Vec<String> {
        let conn = db.conn.lock().unwrap();
        let mut ids: Vec<String> = search_notes_fts(&conn, query)
            .unwrap_or_else(|e| panic!("search for {query:?} failed: {e}"))
            .into_iter()
            .map(|n| n.id)
            .collect();
        ids.sort();
        ids
    }

    #[test]
    fn punctuation_in_ordinary_searches_is_not_query_syntax() {
        let db = notebook();
        assert_eq!(ids(&db, "q3-planning"), ["n1"]);
        assert_eq!(ids(&db, "don't"), ["n2"]);
        assert_eq!(ids(&db, "v1.2"), ["n2"]);
        // The tokenizer drops '+', so this is the prefix "c": it also matches
        // "colors", but it no longer errors and it finds the C++ note.
        assert!(ids(&db, "C++").contains(&"n3".to_string()));
        assert_eq!(ids(&db, "sam@example.com"), ["n3"]);
        assert_eq!(ids(&db, "#design"), ["n4"]);
        assert_eq!(ids(&db, "colors: warm"), ["n4"]);
    }

    #[test]
    fn operators_and_stray_quotes_do_not_error() {
        let db = notebook();
        for query in ["budget AND", "NOT", "OR design", "\"design", "(tokens", "a\"b", "-", "*"] {
            ids(&db, query); // panics on an FTS syntax error
        }
    }

    #[test]
    fn the_last_word_matches_as_a_prefix_while_typing() {
        let db = notebook();
        assert_eq!(ids(&db, "plan"), ["n1"]);
        assert_eq!(ids(&db, "release v1"), ["n2"]);
    }

    #[test]
    fn a_blank_query_returns_nothing() {
        let db = notebook();
        assert!(ids(&db, "   ").is_empty());
    }
}
