pub mod models;
pub mod schema;

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

use crate::db::models::{AudioSegment, Summary, SummaryType, TranscriptSegment, UploadedAudio};
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
    /// source_type: 'upload' (from uploaded_audio), 'segment' (from audio_segments), 'live' (from live transcription)
    /// source_id: the id of the source record (uploaded_audio.id or audio_segments.id)
    pub fn add_transcript_segment(
        &self,
        note_id: &str,
        start_time: f64,
        end_time: f64,
        text: &str,
        speaker: Option<&str>,
        source_type: Option<&str>,
        source_id: Option<i64>,
    ) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let now = Utc::now();

        conn.execute(
            "INSERT INTO transcript_segments (note_id, start_time, end_time, text, speaker, source_type, source_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![note_id, start_time, end_time, text, speaker, source_type, source_id, now.to_rfc3339()],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Add multiple transcript segments in a single transaction (batch insert)
    /// Tuple: (note_id, start, end, text, speaker, source_type, source_id)
    pub fn add_transcript_segments_batch(
        &self,
        segments: &[(String, f64, f64, String, Option<String>, Option<String>, Option<i64>)],
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

            for (note_id, start_time, end_time, text, speaker, source_type, source_id) in segments {
                stmt.execute(params![note_id, start_time, end_time, text, speaker.as_deref(), source_type.as_deref(), source_id, &now])?;
                count += 1;
            }
        }

        tx.commit()?;
        Ok(count)
    }

    /// Get all transcript segments for a note
    pub fn get_transcript_segments(&self, note_id: &str) -> anyhow::Result<Vec<TranscriptSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, start_time, end_time, text, speaker, source_type, source_id, created_at
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
                    source_type: row.get(6)?,
                    source_id: row.get(7)?,
                    created_at: row.get::<_, String>(8)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(segments)
    }

    /// Delete all transcript segments for a note
    #[allow(dead_code)]
    pub fn delete_transcript_segments(&self, note_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "DELETE FROM transcript_segments WHERE note_id = ?1",
            [note_id],
        )?;
        Ok(())
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

    /// Delete all summaries for a note
    #[allow(dead_code)]
    pub fn delete_note_summaries(&self, note_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM summaries WHERE note_id = ?1", [note_id])?;
        Ok(())
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
        mic_path: &str,
        system_path: Option<&str>,
        start_offset_ms: i64,
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
            params![note_id, segment_index, mic_path, system_path, start_offset_ms, display_order, now.to_rfc3339()],
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
    pub fn get_audio_segments(&self, note_id: &str) -> anyhow::Result<Vec<AudioSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, note_id, segment_index, mic_path, system_path, start_offset_ms, duration_ms, display_order, created_at
             FROM audio_segments
             WHERE note_id = ?1
             ORDER BY display_order ASC",
        )?;

        let segments = stmt
            .query_map([note_id], |row| {
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
            })?
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

    /// Get total duration of all segments for a note (in ms)
    pub fn get_total_segment_duration(&self, note_id: &str) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let total: Option<i64> = conn
            .query_row(
                "SELECT COALESCE(SUM(duration_ms), 0) FROM audio_segments WHERE note_id = ?1",
                [note_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        Ok(total.unwrap_or(0))
    }

    /// Delete all audio segments for a note
    pub fn delete_audio_segments(&self, note_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "DELETE FROM audio_segments WHERE note_id = ?1",
            [note_id],
        )?;
        Ok(())
    }

    /// Get the latest (most recent) segment for a note
    #[allow(dead_code)]
    pub fn get_latest_segment(&self, note_id: &str) -> anyhow::Result<Option<AudioSegment>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        let segment = conn
            .query_row(
                "SELECT id, note_id, segment_index, mic_path, system_path, start_offset_ms, duration_ms, display_order, created_at
                 FROM audio_segments
                 WHERE note_id = ?1
                 ORDER BY segment_index DESC
                 LIMIT 1",
                [note_id],
                |row| {
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
                },
            )
            .ok();

        Ok(segment)
    }

    /// Get an audio segment by ID
    pub fn get_audio_segment_by_id(&self, id: i64) -> anyhow::Result<AudioSegment> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;

        conn.query_row(
            "SELECT id, note_id, segment_index, mic_path, system_path, start_offset_ms, duration_ms, display_order, created_at
             FROM audio_segments WHERE id = ?1",
            [id],
            |row| {
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
            },
        )
        .map_err(|e| anyhow::anyhow!("Audio segment not found: {}", e))
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

    /// Update speaker label for uploaded audio
    pub fn update_uploaded_audio_speaker(&self, id: i64, speaker_label: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute(
            "UPDATE uploaded_audio SET speaker_label = ?1 WHERE id = ?2",
            params![speaker_label, id],
        )?;
        Ok(())
    }

    /// Delete uploaded audio by ID
    pub fn delete_uploaded_audio(&self, id: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM uploaded_audio WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Delete all uploaded audio for a note
    #[allow(dead_code)]
    pub fn delete_note_uploaded_audio(&self, note_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        conn.execute("DELETE FROM uploaded_audio WHERE note_id = ?1", [note_id])?;
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
            mic_path: audio_path,
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
