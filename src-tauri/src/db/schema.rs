use rusqlite::Connection;

#[allow(dead_code)]
pub const SCHEMA_VERSION: i32 = 9;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    let version = get_schema_version(conn)?;

    if version < 1 {
        migrate_v1(conn)?;
    }
    if version < 2 {
        migrate_v2(conn)?;
    }
    if version < 3 {
        migrate_v3(conn)?;
    }
    if version < 4 {
        migrate_v4(conn)?;
    }
    if version < 5 {
        migrate_v5(conn)?;
    }
    if version < 6 {
        migrate_v6(conn)?;
    }
    if version < 7 {
        migrate_v7(conn)?;
    }
    if version < 8 {
        migrate_v8(conn)?;
    }
    if version < 9 {
        migrate_v9(conn)?;
    }

    Ok(())
}

fn get_schema_version(conn: &Connection) -> rusqlite::Result<i32> {
    // Create schema_version table if it doesn't exist
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )",
        [],
    )?;

    let version: i32 = conn
        .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    Ok(version)
}

fn set_schema_version(conn: &Connection, version: i32) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM schema_version", [])?;
    conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])?;
    Ok(())
}

fn migrate_v1(conn: &Connection) -> rusqlite::Result<()> {
    // Notes table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            audio_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Transcript segments table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS transcript_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            text TEXT NOT NULL,
            speaker TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Index for faster transcript lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transcript_note
         ON transcript_segments(note_id)",
        [],
    )?;

    // Summaries table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            summary_type TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Index for faster summary lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_summary_note
         ON summaries(note_id)",
        [],
    )?;

    set_schema_version(conn, 1)?;

    Ok(())
}

fn migrate_v2(conn: &Connection) -> rusqlite::Result<()> {
    // Add description and participants columns to notes
    conn.execute(
        "ALTER TABLE notes ADD COLUMN description TEXT",
        [],
    )?;
    conn.execute(
        "ALTER TABLE notes ADD COLUMN participants TEXT",
        [],
    )?;

    // Create full-text search index for note search
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            description,
            participants,
            content='notes',
            content_rowid='rowid'
        )",
        [],
    )?;

    // Create triggers to keep FTS in sync
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, description, participants)
            VALUES (NEW.rowid, NEW.title, NEW.description, NEW.participants);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, description, participants)
            VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.participants);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, description, participants)
            VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.participants);
            INSERT INTO notes_fts(rowid, title, description, participants)
            VALUES (NEW.rowid, NEW.title, NEW.description, NEW.participants);
        END",
        [],
    )?;

    set_schema_version(conn, 2)?;

    Ok(())
}

fn migrate_v3(conn: &Connection) -> rusqlite::Result<()> {
    // Settings table for app preferences
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Insert default theme preference
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system')",
        [],
    )?;

    set_schema_version(conn, 3)?;

    Ok(())
}

fn migrate_v4(conn: &Connection) -> rusqlite::Result<()> {
    // Audio segments table for multi-session recordings (pause/resume/continue)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS audio_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            segment_index INTEGER NOT NULL,
            mic_path TEXT NOT NULL,
            system_path TEXT,
            start_offset_ms INTEGER NOT NULL,
            duration_ms INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Index for faster segment lookups by note
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_audio_segments_note
         ON audio_segments(note_id)",
        [],
    )?;

    set_schema_version(conn, 4)?;

    Ok(())
}

fn migrate_v5(conn: &Connection) -> rusqlite::Result<()> {
    // Uploaded audio table for imported audio files
    conn.execute(
        "CREATE TABLE IF NOT EXISTS uploaded_audio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            duration_ms INTEGER,
            speaker_label TEXT NOT NULL DEFAULT 'Uploaded',
            transcription_status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Index for faster lookups by note
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_uploaded_audio_note
         ON uploaded_audio(note_id)",
        [],
    )?;

    set_schema_version(conn, 5)?;

    Ok(())
}

fn migrate_v6(conn: &Connection) -> rusqlite::Result<()> {
    // Add display_order to audio_segments for reordering
    conn.execute(
        "ALTER TABLE audio_segments ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0",
        [],
    )?;

    // Add display_order to uploaded_audio for reordering
    conn.execute(
        "ALTER TABLE uploaded_audio ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0",
        [],
    )?;

    // Set initial display_order based on creation order
    conn.execute(
        "UPDATE audio_segments SET display_order = segment_index",
        [],
    )?;

    conn.execute(
        "UPDATE uploaded_audio SET display_order = id",
        [],
    )?;

    set_schema_version(conn, 6)?;

    Ok(())
}

fn migrate_v7(conn: &Connection) -> rusqlite::Result<()> {
    // Add source tracking columns to transcript_segments
    // source_type: 'upload' (from uploaded_audio), 'segment' (from audio_segments), 'live' (from live transcription)
    // source_id: the id of the source record (uploaded_audio.id or audio_segments.id)
    conn.execute(
        "ALTER TABLE transcript_segments ADD COLUMN source_type TEXT",
        [],
    )?;

    conn.execute(
        "ALTER TABLE transcript_segments ADD COLUMN source_id INTEGER",
        [],
    )?;

    // Create index for faster deletion by source
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transcript_source
         ON transcript_segments(source_type, source_id)",
        [],
    )?;

    set_schema_version(conn, 7)?;

    Ok(())
}

fn migrate_v8(conn: &Connection) -> rusqlite::Result<()> {
    // Tags table (unique tag names)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT,
            created_at TEXT NOT NULL
        )",
        [],
    )?;

    // Note-tag junction table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (note_id, tag_id),
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Indexes for faster lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id)",
        [],
    )?;

    set_schema_version(conn, 8)?;

    Ok(())
}

fn migrate_v9(conn: &Connection) -> rusqlite::Result<()> {
    // Note links table for wiki-style [[Note Title]] links
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_note_id TEXT NOT NULL,
            target_note_id TEXT,
            target_title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE SET NULL
        )",
        [],
    )?;

    // Indexes for faster lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id)",
        [],
    )?;

    set_schema_version(conn, 9)?;

    Ok(())
}
