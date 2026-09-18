use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub participants: Option<String>, // Comma-separated list
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub audio_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: i64,
    pub note_id: String,
    pub start_time: f64,  // seconds from audio file start
    pub end_time: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub source_type: Option<String>, // 'upload', 'segment', 'live', or null for legacy
    pub source_id: Option<i64>,      // ID of the source audio
    pub created_at: DateTime<Utc>,
}

/// A transcript segment to be inserted. Named fields rather than a positional
/// tuple: `start_time`/`end_time` are both `f64` and `speaker`/`source_type` are
/// both `Option<String>`, so a tuple makes transposing either pair a silent bug.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTranscriptSegment {
    pub note_id: String,
    pub start_time: f64, // seconds from audio file start
    pub end_time: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub source_type: Option<String>, // 'upload', 'segment', 'live', or null
    pub source_id: Option<i64>,      // ID of the source audio
}

impl NewTranscriptSegment {
    /// Convenience constructor for the common case of a live/legacy segment
    /// with no source record.
    pub fn new(
        note_id: impl Into<String>,
        start_time: f64,
        end_time: f64,
        text: impl Into<String>,
    ) -> Self {
        Self {
            note_id: note_id.into(),
            start_time,
            end_time,
            text: text.into(),
            speaker: None,
            source_type: None,
            source_id: None,
        }
    }

    pub fn with_speaker(mut self, speaker: Option<String>) -> Self {
        self.speaker = speaker;
        self
    }

    pub fn with_source(mut self, source_type: &str, source_id: i64) -> Self {
        self.source_type = Some(source_type.to_string());
        self.source_id = Some(source_id);
        self
    }

    /// For sources with no backing record (e.g. live transcription).
    pub fn with_source_type(mut self, source_type: &str) -> Self {
        self.source_type = Some(source_type.to_string());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub id: i64,
    pub note_id: String,
    pub summary_type: SummaryType,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

/// A task: found in a meeting by extract_action_items, or added by hand.
/// A subtask points at its parent through `parent_id`; a standalone task has
/// no note. (The table's `assignee` column was never written and isn't read.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub id: i64,
    pub note_id: Option<String>,
    pub stable_id: String,
    pub text: String,
    pub description: Option<String>,
    pub parent_id: Option<i64>,
    pub due_date: Option<String>,
    pub done: bool,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryType {
    Overview,
    ActionItems,
    KeyDecisions,
    Custom,
}

impl SummaryType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SummaryType::Overview => "overview",
            SummaryType::ActionItems => "action_items",
            SummaryType::KeyDecisions => "key_decisions",
            SummaryType::Custom => "custom",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "overview" => SummaryType::Overview,
            "action_items" => SummaryType::ActionItems,
            "key_decisions" => SummaryType::KeyDecisions,
            _ => SummaryType::Custom,
        }
    }
}

// Input types for creating new records
#[derive(Debug, Deserialize)]
pub struct NewNote {
    pub title: String,
    pub description: Option<String>,
    pub participants: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNote {
    pub title: Option<String>,
    pub description: Option<String>,
    pub participants: Option<String>,
}

/// Audio segment for multi-session recordings (pause/resume/continue)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSegment {
    pub id: i64,
    pub note_id: String,
    pub segment_index: i32,
    pub mic_path: Option<String>,
    pub system_path: Option<String>,
    pub start_offset_ms: i64,
    pub duration_ms: Option<i64>,
    pub display_order: i32,
    pub created_at: DateTime<Utc>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct NewAudioSegment {
    pub note_id: String,
    pub segment_index: i32,
    pub mic_path: Option<String>,
    pub system_path: Option<String>,
    pub start_offset_ms: i64,
}

/// Uploaded audio file for a note
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedAudio {
    pub id: i64,
    pub note_id: String,
    pub file_path: String,
    pub original_filename: String,
    pub duration_ms: Option<i64>,
    pub speaker_label: String,
    pub transcription_status: String, // "pending", "processing", "completed", "failed"
    pub display_order: i32,
    pub created_at: DateTime<Utc>,
}
