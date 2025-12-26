import { invoke } from "@tauri-apps/api/core";
import type {
  ModelInfo,
  ModelSize,
  TranscriptSegment,
  TranscriptionResult,
} from "../types";

/** Result of dual transcription (mic + system audio) */
export interface DualTranscriptionResult {
  /** Transcription result from mic audio ("You") */
  micResult: TranscriptionResult;
  /** Transcription result from system audio ("Others"), if available */
  systemResult: TranscriptionResult | null;
  /** Total number of segments saved */
  totalSegments: number;
}

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

  isDownloading: (): Promise<boolean> => {
    return invoke("is_downloading");
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
  transcribeAudio: (
    audioPath: string,
    meetingId: string,
    speaker?: string
  ): Promise<TranscriptionResult> => {
    return invoke("transcribe_audio", { audioPath, meetingId, speaker });
  },

  /** Transcribe dual audio files (mic and system) with speaker labels */
  transcribeDualAudio: (
    micPath: string,
    systemPath: string | null,
    meetingId: string
  ): Promise<DualTranscriptionResult> => {
    return invoke("transcribe_dual_audio", { micPath, systemPath, meetingId });
  },

  isTranscribing: (): Promise<boolean> => {
    return invoke("is_transcribing");
  },

  getTranscript: (meetingId: string): Promise<TranscriptSegment[]> => {
    return invoke("get_transcript", { meetingId });
  },

  addTranscriptSegment: (
    meetingId: string,
    startTime: number,
    endTime: number,
    text: string,
    speaker?: string
  ): Promise<number> => {
    return invoke("add_transcript_segment", {
      meetingId,
      startTime,
      endTime,
      text,
      speaker,
    });
  },

  // Live transcription
  startLiveTranscription: (meetingId: string): Promise<void> => {
    return invoke("start_live_transcription", { meetingId });
  },

  stopLiveTranscription: (meetingId: string): Promise<TranscriptionResult> => {
    return invoke("stop_live_transcription", { meetingId });
  },

  isLiveTranscribing: (): Promise<boolean> => {
    return invoke("is_live_transcribing");
  },
};
