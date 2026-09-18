pub mod models;
pub mod schema;

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};

use crate::db::models::{
    ActionItem, AudioSegment, NewTranscriptSegment, Summary, SummaryType,
    TranscriptSegment, UploadedAudio,
};
use crate::db::schema::run_migrations;

/// Column order for reading an `ActionItem` row (see `map_action_item`).
const ACTION_ITEM_COLS: &str =
    "id, note_id, stable_id, text, description, parent_id, due_date, done, sort_order, created_at, updated_at";

/// Row -> AudioSegment. Shared so the by-note and by-id queries cannot drift.
fn map_audio_segment(row: &rusqlite::Row) -> rusqlite::Result<AudioSegment> {
    Ok(AudioSegment {
        id: row.get(0)?,
        note_id: row.get(1)?,
        segment_index: row.get(2)?,
        mic_path: row.get(3)?,
        system_path: row.get(4)?,
        start_offset_ms: row.get(5)?,
        duration_ms: row.get(6)?,
        display_order: row.get(7)?,
        created_at: row.get::<_, String>(8)?.parse().unwrap_or_else(|_| Utc::now()),
    })
}

pub struct Database {
    pub conn: Mutex<Connection>,
}

/// Undo state that only a running process could have been in the middle of.
/// Nothing is transcribing at launch, so an import still marked "processing"
/// was interrupted (the app quit or crashed mid-pass): mark it failed so it
/// offers Retry instead of spinning forever.
fn repair_interrupted_work(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE uploaded_audio SET transcription_status = 'failed'
         WHERE transcription_status = 'processing'",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
impl Database {
    /// A migrated in-memory database, for tests that exercise real queries.
    pub fn in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_migrations(&conn).expect("run migrations");
        Self {
            conn: Mutex::new(conn),
        }
    }
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
        repair_interrupted_work(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Add a transcript segment to the database
    /// source_type: 'upload' (from uploaded_audio), 'segment' (from audio_segments), 'live' (from live transcription)
    /// source_id: the id of the source record (uploaded_audio.id or audio_segments.id)
    pub fn add_transcript_segment(&self, segment: &NewTranscriptSegment) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now();

        conn.execute(
            "INSERT INTO transcript_segments (note_id, start_time, end_time, text, speaker, source_type, source_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                segment.note_id,
                segment.start_time,
                segment.end_time,
                segment.text,
                segment.speaker,
                segment.source_type,
                segment.source_id,
                now.to_rfc3339()
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Atomically replace a note's transcript with `segments`.
    ///
    /// The delete and the inserts share one transaction, so an interruption
    /// leaves the previous transcript intact. Retranscription used to delete
    /// first and insert as it went, which meant closing the app mid-pass (or any
    /// error after the delete) destroyed a perfectly good transcript with no way
    /// back — the audio survives, but the text was gone.
    pub fn replace_transcript_segments(
        &self,
        note_id: &str,
        segments: &[NewTranscriptSegment],
    ) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now().to_rfc3339();

        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM transcript_segments WHERE note_id = ?1",
            [note_id],
        )?;
        let count = Self::insert_segments(&tx, segments, &now)?;
        tx.commit()?;
        Ok(count)
    }

    /// Replace the transcript lines of one source (an import or a recording
    /// segment) in a single transaction, leaving the note's other lines alone.
    pub fn replace_source_transcript(
        &self,
        source_type: &str,
        source_id: i64,
        segments: &[NewTranscriptSegment],
    ) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now().to_rfc3339();

        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM transcript_segments WHERE source_type = ?1 AND source_id = ?2",
            params![source_type, source_id],
        )?;
        let count = Self::insert_segments(&tx, segments, &now)?;
        tx.commit()?;
        Ok(count)
    }

    fn insert_segments(
        tx: &rusqlite::Transaction,
        segments: &[NewTranscriptSegment],
        now: &str,
    ) -> rusqlite::Result<usize> {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO transcript_segments (note_id, start_time, end_time, text, speaker, source_type, source_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for segment in segments {
            stmt.execute(params![
                segment.note_id,
                segment.start_time,
                segment.end_time,
                segment.text,
                segment.speaker,
                segment.source_type,
                segment.source_id,
                now
            ])?;
        }
        Ok(segments.len())
    }

    /// Add multiple transcript segments in a single transaction (batch insert)
    pub fn add_transcript_segments_batch(
        &self,
        segments: &[NewTranscriptSegment],
    ) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now().to_rfc3339();

        let tx = conn.transaction()?;
        let mut count = 0;

        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO transcript_segments (note_id, start_time, end_time, text, speaker, source_type, source_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;

            for segment in segments {
                stmt.execute(params![
                    segment.note_id,
                    segment.start_time,
                    segment.end_time,
                    segment.text,
                    segment.speaker,
                    segment.source_type,
                    segment.source_id,
                    &now
                ])?;
                count += 1;
            }
        }

        tx.commit()?;
        Ok(count)
    }

    /// Get all transcript segments for a note
    /// Orders by source display_order first (so transcripts from each audio appear together),
    /// then by start_time within each source, then by insertion id as a stable tiebreaker
    /// (so segments with equal/duplicate start_times keep insertion order rather than
    /// reordering nondeterministically).
    pub fn get_transcript_segments(&self, note_id: &str) -> anyhow::Result<Vec<TranscriptSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT t.id, t.note_id, t.start_time, t.end_time, t.text, t.speaker, t.source_type, t.source_id, t.created_at
             FROM transcript_segments t
             LEFT JOIN audio_segments a ON t.source_type = 'segment' AND t.source_id = a.id
             LEFT JOIN uploaded_audio u ON t.source_type = 'upload' AND t.source_id = u.id
             WHERE t.note_id = ?1
             ORDER BY COALESCE(a.display_order, u.display_order, 999999) ASC, t.start_time ASC, t.id ASC",
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
                    source_type: row.get(6)?,
                    source_id: row.get(7)?,
                    created_at: row.get::<_, String>(8)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(segments)
    }

    /// Delete transcript segments by source (e.g., when deleting an uploaded audio)
    pub fn delete_transcript_segments_by_source(
        &self,
        source_type: &str,
        source_id: i64,
    ) -> anyhow::Result<usize> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let deleted = conn.execute(
            "DELETE FROM transcript_segments WHERE source_type = ?1 AND source_id = ?2",
            params![source_type, source_id],
        )?;
        Ok(deleted)
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

    /// Get a note's action items (all, including subtasks; the frontend nests
    /// them by parent_id). The table is the source of truth.
    pub fn get_action_items(&self, note_id: &str) -> anyhow::Result<Vec<ActionItem>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {ACTION_ITEM_COLS} FROM action_items
             WHERE note_id = ?1
             ORDER BY sort_order ASC, created_at ASC",
        ))?;
        let items = stmt
            .query_map([note_id], Self::map_action_item)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(items)
    }

    /// Open (unchecked) top-level tasks across all notes plus their subtasks —
    /// the default central Tasks page load. Bounded by the number of open tasks.
    pub fn get_open_action_items(&self) -> anyhow::Result<Vec<ActionItem>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {ACTION_ITEM_COLS} FROM action_items
             WHERE (parent_id IS NULL AND done = 0)
                OR parent_id IN (SELECT id FROM action_items WHERE parent_id IS NULL AND done = 0)
             ORDER BY sort_order ASC, created_at ASC",
        ))?;
        let items = stmt
            .query_map([], Self::map_action_item)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(items)
    }

    /// A page of completed top-level tasks (newest first) plus their subtasks,
    /// loaded lazily so a long history isn't pulled in one go.
    pub fn get_completed_action_items(
        &self,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ActionItem>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let mut stmt = conn.prepare(&format!(
            "WITH page AS (
                 SELECT id FROM action_items
                 WHERE parent_id IS NULL AND done = 1
                 ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2
             )
             SELECT {ACTION_ITEM_COLS} FROM action_items
             WHERE id IN (SELECT id FROM page) OR parent_id IN (SELECT id FROM page)
             ORDER BY updated_at DESC",
        ))?;
        let items = stmt
            .query_map([limit, offset], Self::map_action_item)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(items)
    }

    /// Create an action item (top-level, or a subtask when `parent_id` is set).
    /// `note_id` is None for a standalone task (central Tasks page).
    pub fn create_action_item(
        &self,
        note_id: Option<&str>,
        stable_id: &str,
        text: &str,
        due_date: Option<&str>,
        parent_id: Option<i64>,
        description: Option<&str>,
    ) -> anyhow::Result<ActionItem> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now().to_rfc3339();
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM action_items WHERE note_id IS ?1",
            [note_id],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO action_items
                 (note_id, stable_id, text, description, parent_id, due_date, done, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?8)",
            params![note_id, stable_id, text, description, parent_id, due_date, next_order, now],
        )?;
        let id = conn.last_insert_rowid();
        Self::action_item_by_id(&conn, id)
    }

    /// Update an action item's fields (text / description / due date / done).
    pub fn update_action_item(
        &self,
        id: i64,
        text: &str,
        description: Option<&str>,
        due_date: Option<&str>,
        done: bool,
    ) -> anyhow::Result<ActionItem> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE action_items
                SET text = ?2, description = ?3, due_date = ?4, done = ?5, updated_at = ?6
              WHERE id = ?1",
            params![id, text, description, due_date, done as i32, now],
        )?;
        Self::action_item_by_id(&conn, id)
    }

    /// Set just the done flag. Extraction stores a checked (`- [x]`) item this way.
    pub fn set_action_item_done(&self, id: i64, done: bool) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE action_items SET done = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, done as i32, now],
        )?;
        Ok(())
    }

    /// Delete an action item and any subtasks under it.
    pub fn delete_action_item(&self, id: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM action_items WHERE id = ?1 OR parent_id = ?1", [id])?;
        Ok(())
    }

    fn map_action_item(row: &rusqlite::Row) -> rusqlite::Result<ActionItem> {
        Ok(ActionItem {
            id: row.get(0)?,
            note_id: row.get(1)?,
            stable_id: row.get(2)?,
            text: row.get(3)?,
            description: row.get(4)?,
            parent_id: row.get(5)?,
            due_date: row.get(6)?,
            done: row.get::<_, i32>(7)? != 0,
            sort_order: row.get(8)?,
            created_at: row.get::<_, String>(9)?.parse().unwrap_or_else(|_| Utc::now()),
            updated_at: row.get::<_, String>(10)?.parse().unwrap_or_else(|_| Utc::now()),
        })
    }

    fn action_item_by_id(conn: &Connection, id: i64) -> anyhow::Result<ActionItem> {
        let item = conn.query_row(
            &format!("SELECT {ACTION_ITEM_COLS} FROM action_items WHERE id = ?1"),
            [id],
            Self::map_action_item,
        )?;
        Ok(item)
    }

    /// When the note's meeting started (RFC 3339, UTC).
    pub fn get_note_started_at(&self, note_id: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let started_at = conn
            .query_row(
                "SELECT started_at FROM notes WHERE id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(started_at)
    }

    /// Get the description (user notes) for a note
    pub fn get_note_description(&self, note_id: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let description: Option<String> = conn
            .query_row(
                "SELECT description FROM notes WHERE id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        Ok(description)
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

    // ========== Audio Segments (for pause/resume/continue) ==========

    /// Add a new audio segment for a note
    pub fn add_audio_segment(
        &self,
        note_id: &str,
        segment_index: i32,
        mic_path: Option<&str>,
        system_path: Option<&str>,
    ) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now();

        // Get the next display_order for this note
        let max_order: Option<i32> = conn
            .query_row(
                "SELECT MAX(display_order) FROM audio_segments WHERE note_id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        let display_order = max_order.map(|o| o + 1).unwrap_or(0);

        conn.execute(
            "INSERT INTO audio_segments (note_id, segment_index, mic_path, system_path, start_offset_ms, display_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            // start_offset_ms is kept as 0: nothing reads it, and offsets
            // follow from the segments' durations.
            params![note_id, segment_index, mic_path, system_path, 0, display_order, now.to_rfc3339()],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Update segment duration when recording stops
    pub fn update_segment_duration(&self, segment_id: i64, duration_ms: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "UPDATE audio_segments SET duration_ms = ?1 WHERE id = ?2",
            params![duration_ms, segment_id],
        )?;
        Ok(())
    }

    /// Get all audio segments for a note, ordered by display_order
    /// Fetch a single audio segment by id.
    pub fn get_audio_segment(&self, segment_id: i64) -> anyhow::Result<Option<AudioSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, segment_index, mic_path, system_path, start_offset_ms, duration_ms, display_order, created_at
             FROM audio_segments
             WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map([segment_id], map_audio_segment)?;
        Ok(rows.next().transpose()?)
    }

    pub fn get_audio_segments(&self, note_id: &str) -> anyhow::Result<Vec<AudioSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, segment_index, mic_path, system_path, start_offset_ms, duration_ms, display_order, created_at
             FROM audio_segments
             WHERE note_id = ?1
             ORDER BY display_order ASC",
        )?;

        let segments = stmt
            .query_map([note_id], map_audio_segment)?
            .filter_map(|r| r.ok())
            .collect();

        Ok(segments)
    }

    /// Get the next segment index for a note
    pub fn get_next_segment_index(&self, note_id: &str) -> anyhow::Result<i32> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let max_index: Option<i32> = conn
            .query_row(
                "SELECT MAX(segment_index) FROM audio_segments WHERE note_id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        Ok(max_index.map(|i| i + 1).unwrap_or(0))
    }

    // ========== Uploaded Audio ==========

    /// Add an uploaded audio file record
    pub fn add_uploaded_audio(
        &self,
        note_id: &str,
        file_path: &str,
        original_filename: &str,
        duration_ms: Option<i64>,
        speaker_label: &str,
    ) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now();

        // Get the next display_order for this note (across both segments and uploads)
        let max_segment_order: Option<i32> = conn
            .query_row(
                "SELECT MAX(display_order) FROM audio_segments WHERE note_id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        let max_upload_order: Option<i32> = conn
            .query_row(
                "SELECT MAX(display_order) FROM uploaded_audio WHERE note_id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        let display_order = std::cmp::max(
            max_segment_order.unwrap_or(-1),
            max_upload_order.unwrap_or(-1),
        ) + 1;

        conn.execute(
            "INSERT INTO uploaded_audio (note_id, file_path, original_filename, duration_ms, speaker_label, display_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![note_id, file_path, original_filename, duration_ms, speaker_label, display_order, now.to_rfc3339()],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get all uploaded audio for a note, ordered by display_order
    pub fn get_uploaded_audio(&self, note_id: &str) -> anyhow::Result<Vec<UploadedAudio>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, file_path, original_filename, duration_ms, speaker_label, transcription_status, display_order, created_at
             FROM uploaded_audio
             WHERE note_id = ?1
             ORDER BY display_order ASC",
        )?;

        let uploads = stmt
            .query_map([note_id], |row| {
                Ok(UploadedAudio {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    file_path: row.get(2)?,
                    original_filename: row.get(3)?,
                    duration_ms: row.get(4)?,
                    speaker_label: row.get(5)?,
                    transcription_status: row.get(6)?,
                    display_order: row.get(7)?,
                    created_at: row.get::<_, String>(8)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(uploads)
    }

    /// Get uploaded audio by ID
    pub fn get_uploaded_audio_by_id(&self, id: i64) -> anyhow::Result<UploadedAudio> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        conn.query_row(
            "SELECT id, note_id, file_path, original_filename, duration_ms, speaker_label, transcription_status, display_order, created_at
             FROM uploaded_audio WHERE id = ?1",
            [id],
            |row| {
                Ok(UploadedAudio {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    file_path: row.get(2)?,
                    original_filename: row.get(3)?,
                    duration_ms: row.get(4)?,
                    speaker_label: row.get(5)?,
                    transcription_status: row.get(6)?,
                    display_order: row.get(7)?,
                    created_at: row.get::<_, String>(8)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            },
        )
        .map_err(|e| anyhow::anyhow!("Uploaded audio not found: {}", e))
    }

    /// Update transcription status for uploaded audio
    pub fn update_uploaded_audio_status(&self, id: i64, status: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "UPDATE uploaded_audio SET transcription_status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    /// Delete uploaded audio by ID
    pub fn delete_uploaded_audio(&self, id: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM uploaded_audio WHERE id = ?1", [id])?;
        Ok(())
    }

    // ========== Audio Ordering ==========

    /// Reorder audio items for a note. Takes a list of (type, id, new_order) tuples
    /// where type is "segment" or "upload"
    pub fn reorder_audio_items(
        &self,
        items: &[(String, i64, i32)], // (item_type, id, new_order)
    ) -> anyhow::Result<()> {
        let mut conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let tx = conn.transaction()?;

        for (item_type, id, new_order) in items {
            match item_type.as_str() {
                "segment" => {
                    tx.execute(
                        "UPDATE audio_segments SET display_order = ?1 WHERE id = ?2",
                        params![new_order, id],
                    )?;
                }
                "upload" => {
                    tx.execute(
                        "UPDATE uploaded_audio SET display_order = ?1 WHERE id = ?2",
                        params![new_order, id],
                    )?;
                }
                _ => {}
            }
        }

        tx.commit()?;
        Ok(())
    }

    // ========== Legacy Audio Migration ==========

    /// Forget a segment's system-audio file: capture never started for it.
    pub fn clear_segment_system_path(&self, segment_id: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "UPDATE audio_segments SET system_path = NULL WHERE id = ?1",
            [segment_id],
        )?;
        Ok(())
    }

    /// The note's combined playback track (`notes.audio_path`), if any.
    pub fn get_note_audio_path(&self, note_id: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let path = conn
            .query_row(
                "SELECT audio_path FROM notes WHERE id = ?1",
                [note_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        Ok(path)
    }

    /// Point a note at a rebuilt playback track. updated_at is left alone: the
    /// track is derived from audio the note already had.
    pub fn set_note_audio_path(&self, note_id: &str, path: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "UPDATE notes SET audio_path = ?1 WHERE id = ?2",
            params![path, note_id],
        )?;
        Ok(())
    }

    /// Migrate legacy audio_path to audio_segments table.
    /// Returns the created segment if migration occurred, None if no migration needed.
    pub fn migrate_legacy_audio(
        &self,
        note_id: &str,
        duration_ms: Option<i64>,
    ) -> anyhow::Result<Option<AudioSegment>> {
        let mut conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        // Check if note has audio_path
        let audio_path: Option<String> = conn
            .query_row(
                "SELECT audio_path FROM notes WHERE id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        let audio_path = match audio_path {
            Some(path) if !path.is_empty() => path,
            _ => return Ok(None), // No legacy audio to migrate
        };

        // Check if note already has segments
        let segment_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM audio_segments WHERE note_id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if segment_count > 0 {
            return Ok(None); // Already has segments, don't migrate
        }

        // Perform migration in a transaction
        let tx = conn.transaction()?;
        let now = Utc::now();

        // Shift all existing uploads' display_order by 1 to make room at position 0
        tx.execute(
            "UPDATE uploaded_audio SET display_order = display_order + 1 WHERE note_id = ?1",
            [note_id],
        )?;

        // Insert new audio segment at position 0
        tx.execute(
            "INSERT INTO audio_segments (note_id, segment_index, mic_path, system_path, start_offset_ms, duration_ms, display_order, created_at)
             VALUES (?1, 0, ?2, NULL, 0, ?3, 0, ?4)",
            params![note_id, &audio_path, duration_ms, now.to_rfc3339()],
        )?;

        let segment_id = tx.last_insert_rowid();

        // Clear the legacy audio_path
        tx.execute(
            "UPDATE notes SET audio_path = NULL, updated_at = ?1 WHERE id = ?2",
            params![now.to_rfc3339(), note_id],
        )?;

        tx.commit()?;

        // Return the created segment
        Ok(Some(AudioSegment {
            id: segment_id,
            note_id: note_id.to_string(),
            segment_index: 0,
            mic_path: Some(audio_path),
            system_path: None,
            start_offset_ms: 0,
            duration_ms,
            display_order: 0,
            created_at: now,
        }))
    }
}

fn get_db_path(app_handle: &AppHandle) -> anyhow::Result<PathBuf> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

    Ok(app_data_dir.join("note67.db"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_with_import(db: &Database) -> i64 {
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO notes (id, title, started_at, created_at, updated_at)
                 VALUES ('n1', 'Call', '2026-01-05T12:00:00Z', '2026-01-05T12:00:00Z', '2026-01-05T12:00:00Z')",
                [],
            )
            .unwrap();
        let upload = db
            .add_uploaded_audio("n1", "/tmp/n1_upload.wav", "call.m4a", Some(1000), "Uploaded")
            .unwrap();
        let first = NewTranscriptSegment::new("n1", 0.0, 1.0, "the original line")
            .with_source("upload", upload);
        db.replace_source_transcript("upload", upload, &[first]).unwrap();
        upload
    }

    fn texts(db: &Database) -> Vec<String> {
        db.get_transcript_segments("n1")
            .unwrap()
            .into_iter()
            .map(|s| s.text)
            .collect()
    }

    #[test]
    fn replacing_an_import_transcript_swaps_only_its_lines() {
        let db = Database::in_memory();
        let upload = note_with_import(&db);
        db.add_transcript_segment(&NewTranscriptSegment::new("n1", 5.0, 6.0, "a live line"))
            .unwrap();

        let redo = NewTranscriptSegment::new("n1", 0.0, 1.0, "the better line")
            .with_source("upload", upload);
        db.replace_source_transcript("upload", upload, &[redo]).unwrap();

        let mut lines = texts(&db);
        lines.sort();
        assert_eq!(lines, ["a live line", "the better line"]);
    }

    #[test]
    fn a_failed_replace_keeps_the_previous_import_transcript() {
        let db = Database::in_memory();
        let upload = note_with_import(&db);
        // A line for a note that doesn't exist fails its foreign key, the way
        // a note deleted mid-transcription did.
        let orphan = NewTranscriptSegment::new("gone", 0.0, 1.0, "new line")
            .with_source("upload", upload);

        assert!(db.replace_source_transcript("upload", upload, &[orphan]).is_err());
        assert_eq!(texts(&db), ["the original line"]);
    }

    #[test]
    fn imports_interrupted_mid_transcription_are_marked_failed() {
        let db = Database::in_memory();
        let upload = note_with_import(&db);
        db.update_uploaded_audio_status(upload, "processing").unwrap();

        repair_interrupted_work(&db.conn.lock().unwrap()).unwrap();

        let status = db.get_uploaded_audio_by_id(upload).unwrap().transcription_status;
        assert_eq!(status, "failed");
    }
}
