import { invoke } from "@tauri-apps/api/core";
import type {
  ModelInfo,
  ModelSize,
  TranscriptSegment,
  TranscriptionResult,
  RetranscribeResult,
} from "../types";

export const transcriptionApi = {
  // Model management
  listModels: (): Promise<ModelInfo[]> => {
    return invoke("list_models");
  },

  downloadModel: (size: ModelSize): Promise<string> => {
    return invoke("download_model", { size });
  },

  getDownloadProgress: (): Promise<number> => {
    return invoke("get_download_progress");
  },

  deleteModel: (size: ModelSize): Promise<void> => {
    return invoke("delete_model", { size });
  },

  loadModel: (size: ModelSize): Promise<void> => {
    return invoke("load_model", { size });
  },

  getLoadedModel: (): Promise<ModelSize | null> => {
    return invoke("get_loaded_model");
  },

  // Transcription
  getTranscript: (noteId: string): Promise<TranscriptSegment[]> => {
    return invoke("get_transcript", { noteId });
  },

  addTranscriptSegment: (
    noteId: string,
    startTime: number,
    endTime: number,
    text: string,
    speaker?: string
  ): Promise<number> => {
    // The command takes a single NewTranscriptSegment struct, whose fields are
    // snake_case on the wire (matching TranscriptSegment).
    return invoke("add_transcript_segment", {
      segment: {
        note_id: noteId,
        start_time: startTime,
        end_time: endTime,
        text,
        speaker: speaker ?? null,
        source_type: null,
        source_id: null,
      },
    });
  },

  // Live transcription
  startLiveTranscription: (noteId: string, language?: string): Promise<void> => {
    return invoke("start_live_transcription", { noteId, language });
  },

  stopLiveTranscription: (noteId: string): Promise<TranscriptionResult> => {
    return invoke("stop_live_transcription", { noteId });
  },

  isLiveTranscribing: (): Promise<boolean> => {
    return invoke("is_live_transcribing");
  },

  // Retranscription
  /** Retranscribe all audio sources in a note */
  retranscribeNote: (noteId: string): Promise<RetranscribeResult> => {
    return invoke("retranscribe_note", { noteId });
  },
};
