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
    pub start_time: f64,  // seconds from note start
    pub end_time: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub id: i64,
    pub note_id: String,
    pub summary_type: SummaryType,
    pub content: String,
    pub created_at: DateTime<Utc>,
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct NewTranscriptSegment {
    pub note_id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
    pub speaker: Option<String>,
}

/// Audio segment for multi-session recordings (pause/resume/continue)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSegment {
    pub id: i64,
    pub note_id: String,
    pub segment_index: i32,
    pub mic_path: String,
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
    pub mic_path: String,
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
