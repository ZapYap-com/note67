export interface Note {
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

export interface NewNote {
  title: string;
  description?: string;
  participants?: string;
}

export interface UpdateNote {
  title?: string;
  description?: string;
  participants?: string;
}

export interface TranscriptSegment {
  id: number;
  note_id: string;
  start_time: number; // seconds from audio file start
  end_time: number;
  text: string;
  speaker: string | null;
  source_type: string | null; // 'upload', 'segment', 'live', or null for legacy
  source_id: number | null; // ID of the source audio (uploaded_audio.id or audio_segments.id)
  created_at: string;
}

export interface Summary {
  id: number;
  note_id: string;
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

// Audio segment for pause/resume/continue recording
export interface AudioSegment {
  id: number;
  note_id: string;
  segment_index: number;
  mic_path: string;
  system_path: string | null;
  start_offset_ms: number;
  duration_ms: number | null;
  display_order: number;
  created_at: string;
}

// Recording phase enum (matches Rust RecordingPhase)
export enum RecordingPhase {
  Idle = 0,
  Recording = 1,
  Paused = 2,
}

// Uploaded audio file
export interface UploadedAudio {
  id: number;
  note_id: string;
  file_path: string;
  original_filename: string;
  duration_ms: number | null;
  speaker_label: string;
  transcription_status: "pending" | "processing" | "completed" | "failed";
  display_order: number;
  created_at: string;
}

// Unified audio item for ordering (combines segments and uploads)
export type AudioItem =
  | { type: "segment"; data: AudioSegment }
  | { type: "upload"; data: UploadedAudio };

// Result of retranscribing an entire note
export interface RetranscribeResult {
  totalItems: number;
  completedItems: number;
  failedItems: string[];
  totalSegments: number;
}
