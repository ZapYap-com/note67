use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::models::{Meeting, NewMeeting};
use crate::db::Database;

#[tauri::command]
pub fn create_meeting(db: State<Database>, input: NewMeeting) -> Result<Meeting, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO meetings (id, title, started_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (
            &id,
            &input.title,
            now.to_rfc3339(),
            now.to_rfc3339(),
            now.to_rfc3339(),
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(Meeting {
        id,
        title: input.title,
        started_at: now,
        ended_at: None,
        audio_path: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_meeting(db: State<Database>, id: String) -> Result<Option<Meeting>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let result = conn.query_row(
        "SELECT id, title, started_at, ended_at, audio_path, created_at, updated_at
         FROM meetings WHERE id = ?1",
        [&id],
        |row| {
            Ok(Meeting {
                id: row.get(0)?,
                title: row.get(1)?,
                started_at: parse_datetime(row.get::<_, String>(2)?),
                ended_at: row.get::<_, Option<String>>(3)?.map(parse_datetime),
                audio_path: row.get(4)?,
                created_at: parse_datetime(row.get::<_, String>(5)?),
                updated_at: parse_datetime(row.get::<_, String>(6)?),
            })
        },
    );

    match result {
        Ok(meeting) => Ok(Some(meeting)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn list_meetings(db: State<Database>) -> Result<Vec<Meeting>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, started_at, ended_at, audio_path, created_at, updated_at
             FROM meetings ORDER BY started_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let meetings = stmt
        .query_map([], |row| {
            Ok(Meeting {
                id: row.get(0)?,
                title: row.get(1)?,
                started_at: parse_datetime(row.get::<_, String>(2)?),
                ended_at: row.get::<_, Option<String>>(3)?.map(parse_datetime),
                audio_path: row.get(4)?,
                created_at: parse_datetime(row.get::<_, String>(5)?),
                updated_at: parse_datetime(row.get::<_, String>(6)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(meetings)
}

#[tauri::command]
pub fn end_meeting(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();

    conn.execute(
        "UPDATE meetings SET ended_at = ?1, updated_at = ?2 WHERE id = ?3",
        (now.to_rfc3339(), now.to_rfc3339(), &id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_meeting(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM meetings WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn parse_datetime(s: String) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}
