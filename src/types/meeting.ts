export interface Meeting {
  id: string;
  title: string;
  started_at: string; // ISO 8601 datetime
  ended_at: string | null;
  audio_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewMeeting {
  title: string;
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
