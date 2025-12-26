export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  participants: string | null; // Comma-separated list
  started_at: string; // ISO 8601 datetime
  ended_at: string | null;
  audio_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewMeeting {
  title: string;
  description?: string;
  participants?: string;
}

export interface UpdateMeeting {
  title?: string;
  description?: string;
  participants?: string;
}

export interface TranscriptSegment {
  id: number;
  meeting_id: string;
  start_time: number; // seconds from meeting start
  end_time: number;
  text: string;
  speaker: string | null;
  created_at: string;
}

export interface Summary {
  id: number;
  meeting_id: string;
  summary_type: SummaryType;
  content: string;
  created_at: string;
}

export type SummaryType =
  | "overview"
  | "action_items"
  | "key_decisions"
  | "custom";

// Model types for transcription
export type ModelSize = "tiny" | "base" | "small" | "medium" | "large";

export interface ModelInfo {
  size: ModelSize;
  name: string;
  downloaded: boolean;
  path: string | null;
  size_mb: number;
}

// Segment from whisper transcription (before saving to DB)
export interface TranscriptionSegment {
  start_time: number;
  end_time: number;
  text: string;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  full_text: string;
  language: string | null;
}

// Ollama types for AI summaries
export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

export interface OllamaStatus {
  running: boolean;
  models: OllamaModel[];
  selected_model: string | null;
}
