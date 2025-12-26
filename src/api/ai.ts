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
    noteId: string,
    summaryType: SummaryType,
    customPrompt?: string
  ): Promise<Summary> => {
    return invoke("generate_summary", {
      noteId,
      summaryType,
      customPrompt: customPrompt ?? null,
    });
  },

  // Summary generation with streaming
  generateSummaryStream: (
    noteId: string,
    summaryType: SummaryType,
    customPrompt?: string
  ): Promise<Summary> => {
    return invoke("generate_summary_stream", {
      noteId,
      summaryType,
      customPrompt: customPrompt ?? null,
    });
  },

  getNoteSummaries: (noteId: string): Promise<Summary[]> => {
    return invoke("get_note_summaries", { noteId });
  },

  deleteSummary: (summaryId: number): Promise<void> => {
    return invoke("delete_summary", { summaryId });
  },

  // Title generation
  generateTitle: (noteId: string): Promise<string> => {
    return invoke("generate_title", { noteId });
  },

  // Title generation from summary content
  generateTitleFromSummary: (noteId: string, summaryContent: string): Promise<string> => {
    return invoke("generate_title_from_summary", { noteId, summaryContent });
  },
};
