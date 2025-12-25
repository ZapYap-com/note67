use rusqlite::Connection;

pub const SCHEMA_VERSION: i32 = 1;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    let version = get_schema_version(conn)?;

    if version < 1 {
        migrate_v1(conn)?;
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
    // Meetings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meetings (
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
            meeting_id TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            text TEXT NOT NULL,
            speaker TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Index for faster transcript lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transcript_meeting
         ON transcript_segments(meeting_id)",
        [],
    )?;

    // Summaries table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            summary_type TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Index for faster summary lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_summary_meeting
         ON summaries(meeting_id)",
        [],
    )?;

    set_schema_version(conn, 1)?;

    Ok(())
}
