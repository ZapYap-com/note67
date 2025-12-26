import { invoke } from "@tauri-apps/api/core";
import type { OllamaStatus, OllamaModel, Summary, SummaryType } from "../types";

export const aiApi = {
  // Ollama status
  getOllamaStatus: (): Promise<OllamaStatus> => {
    return invoke("get_ollama_status");
  },

  listOllamaModels: (): Promise<OllamaModel[]> => {
    return invoke("list_ollama_models");
  },

  selectModel: (modelName: string): Promise<void> => {
    return invoke("select_ollama_model", { modelName });
  },

  getSelectedModel: (): Promise<string | null> => {
    return invoke("get_selected_model");
  },

  isGenerating: (): Promise<boolean> => {
    return invoke("is_ai_generating");
  },

  // Summary generation
  generateSummary: (
    meetingId: string,
    summaryType: SummaryType,
    customPrompt?: string
  ): Promise<Summary> => {
    return invoke("generate_summary", {
      meetingId,
      summaryType,
      customPrompt: customPrompt ?? null,
    });
  },

  getMeetingSummaries: (meetingId: string): Promise<Summary[]> => {
    return invoke("get_meeting_summaries", { meetingId });
  },

  deleteSummary: (summaryId: number): Promise<void> => {
    return invoke("delete_summary", { summaryId });
  },

  // Title generation
  generateTitle: (meetingId: string): Promise<string> => {
    return invoke("generate_title", { meetingId });
  },
};
