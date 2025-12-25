use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub audio_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: i64,
    pub meeting_id: String,
    pub start_time: f64,  // seconds from meeting start
    pub end_time: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub id: i64,
    pub meeting_id: String,
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
pub struct NewMeeting {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct NewTranscriptSegment {
    pub meeting_id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
    pub speaker: Option<String>,
}
