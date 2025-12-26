pub mod models;
pub mod schema;

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

use crate::db::models::{Summary, SummaryType, TranscriptSegment};
use crate::db::schema::run_migrations;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_handle: &AppHandle) -> anyhow::Result<Self> {
        let db_path = get_db_path(app_handle)?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;

        // Enable foreign keys
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        // Run migrations
        run_migrations(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Add a transcript segment to the database
    pub fn add_transcript_segment(
        &self,
        note_id: &str,
        start_time: f64,
        end_time: f64,
        text: &str,
        speaker: Option<&str>,
    ) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now();

        conn.execute(
            "INSERT INTO transcript_segments (note_id, start_time, end_time, text, speaker, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![note_id, start_time, end_time, text, speaker, now.to_rfc3339()],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get all transcript segments for a note
    pub fn get_transcript_segments(&self, note_id: &str) -> anyhow::Result<Vec<TranscriptSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, start_time, end_time, text, speaker, created_at
             FROM transcript_segments
             WHERE note_id = ?1
             ORDER BY start_time ASC",
        )?;

        let segments = stmt
            .query_map([note_id], |row| {
                Ok(TranscriptSegment {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                    text: row.get(4)?,
                    speaker: row.get(5)?,
                    created_at: row.get::<_, String>(6)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(segments)
    }

    /// Delete all transcript segments for a note
    pub fn delete_transcript_segments(&self, note_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "DELETE FROM transcript_segments WHERE note_id = ?1",
            [note_id],
        )?;
        Ok(())
    }

    /// Add a summary to the database
    pub fn add_summary(
        &self,
        note_id: &str,
        summary_type: &SummaryType,
        content: &str,
    ) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now();

        conn.execute(
            "INSERT INTO summaries (note_id, summary_type, content, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![note_id, summary_type.as_str(), content, now.to_rfc3339()],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get a summary by ID
    pub fn get_summary(&self, id: i64) -> anyhow::Result<Option<Summary>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, summary_type, content, created_at
             FROM summaries WHERE id = ?1",
        )?;

        let summary = stmt
            .query_row([id], |row| {
                Ok(Summary {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    summary_type: SummaryType::from_str(&row.get::<_, String>(2)?),
                    content: row.get(3)?,
                    created_at: row.get::<_, String>(4)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            })
            .ok();

        Ok(summary)
    }

    /// Get all summaries for a note
    pub fn get_summaries(&self, note_id: &str) -> anyhow::Result<Vec<Summary>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, summary_type, content, created_at
             FROM summaries
             WHERE note_id = ?1
             ORDER BY created_at DESC",
        )?;

        let summaries = stmt
            .query_map([note_id], |row| {
                Ok(Summary {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    summary_type: SummaryType::from_str(&row.get::<_, String>(2)?),
                    content: row.get(3)?,
                    created_at: row.get::<_, String>(4)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(summaries)
    }

    /// Delete a summary
    pub fn delete_summary(&self, id: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM summaries WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Delete all summaries for a note
    pub fn delete_note_summaries(&self, note_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM summaries WHERE note_id = ?1", [note_id])?;
        Ok(())
    }

    /// Get a setting value
    pub fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .ok();
        Ok(value)
    }

    /// Set a setting value
    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }
}

fn get_db_path(app_handle: &AppHandle) -> anyhow::Result<PathBuf> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

    Ok(app_data_dir.join("note67.db"))
}
