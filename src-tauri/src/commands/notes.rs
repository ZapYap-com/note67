use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::models::{AudioSegment, NewNote, Note, UpdateNote};
use crate::db::Database;

#[tauri::command]
pub fn create_note(db: State<Database>, input: NewNote) -> Result<Note, String> {
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
    db: State<Database>,
    id: String,
    update: UpdateNote,
) -> Result<Note, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();

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

    // Return updated note
    drop(conn);
    get_note(db, id)?.ok_or_else(|| "Note not found".to_string())
}

#[tauri::command]
pub fn search_notes(db: State<Database>, query: String) -> Result<Vec<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Use FTS5 search with fallback to LIKE for simple queries
    let search_query = if query.contains('*') || query.contains('"') {
        query.clone()
    } else {
        format!("{}*", query) // Prefix search by default
    };

    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.title, m.description, m.participants, m.started_at, m.ended_at,
                    m.audio_path, m.created_at, m.updated_at
             FROM notes m
             JOIN notes_fts fts ON m.rowid = fts.rowid
             WHERE notes_fts MATCH ?1
             ORDER BY m.started_at DESC
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([&search_query], |row| {
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
        .filter_map(|r| r.ok())
        .collect();

    Ok(notes)
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
pub fn delete_note(db: State<Database>, id: String) -> Result<(), String> {
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
    if let Some(path) = audio_path {
        if !path.is_empty() {
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!("Failed to delete audio file {}: {}", path, e);
            }
        }
    }

    Ok(())
}

fn parse_datetime(s: String) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// ========== Pause/Resume/Continue Recording Support ==========

/// Reopen a note for continued recording
/// Clears ended_at so the note can receive more audio
#[tauri::command]
pub fn reopen_note(db: State<Database>, id: String) -> Result<Note, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();

    // Check if note exists and has been ended
    let ended_at: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM notes WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if ended_at.is_none() {
        return Err("Note has not been ended yet".to_string());
    }

    // Clear ended_at to reopen the note
    conn.execute(
        "UPDATE notes SET ended_at = NULL, updated_at = ?1 WHERE id = ?2",
        (now.to_rfc3339(), &id),
    )
    .map_err(|e| e.to_string())?;

    // Return updated note
    drop(conn);
    get_note(db, id)?.ok_or_else(|| "Note not found".to_string())
}

/// Get all audio segments for a note
#[tauri::command]
pub fn get_note_audio_segments(db: State<Database>, note_id: String) -> Result<Vec<AudioSegment>, String> {
    db.get_audio_segments(&note_id).map_err(|e| e.to_string())
}

/// Get total recording duration for a note (sum of all segment durations)
#[tauri::command]
pub fn get_note_total_duration(db: State<Database>, note_id: String) -> Result<i64, String> {
    db.get_total_segment_duration(&note_id)
        .map_err(|e| e.to_string())
}

/// Delete all audio segment files and records for a note
/// This is called when deleting a note or when starting a completely fresh recording
#[tauri::command]
pub fn delete_note_audio_segments(db: State<Database>, note_id: String) -> Result<(), String> {
    // Get all segments first to delete files
    let segments = db.get_audio_segments(&note_id).map_err(|e| e.to_string())?;

    // Delete audio files
    for segment in segments {
        // Delete mic file
        if let Err(e) = std::fs::remove_file(&segment.mic_path) {
            eprintln!("Failed to delete mic segment file {}: {}", segment.mic_path, e);
        }

        // Delete system audio file if present
        if let Some(ref sys_path) = segment.system_path {
            if let Err(e) = std::fs::remove_file(sys_path) {
                eprintln!("Failed to delete system segment file {}: {}", sys_path, e);
            }
        }
    }

    // Delete segment records from database
    db.delete_audio_segments(&note_id)
        .map_err(|e| e.to_string())
}
