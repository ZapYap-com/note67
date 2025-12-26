import { invoke } from "@tauri-apps/api/core";
import type {
  ModelInfo,
  ModelSize,
  TranscriptSegment,
  TranscriptionResult,
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
    meetingId: string
  ): Promise<TranscriptionResult> => {
    return invoke("transcribe_audio", { audioPath, meetingId });
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
};
