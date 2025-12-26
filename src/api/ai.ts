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
    return invoke("select_ollama_model", { model_name: modelName });
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
      note_id: noteId,
      summary_type: summaryType,
      custom_prompt: customPrompt ?? null,
    });
  },

  // Summary generation with streaming
  generateSummaryStream: (
    noteId: string,
    summaryType: SummaryType,
    customPrompt?: string
  ): Promise<Summary> => {
    return invoke("generate_summary_stream", {
      note_id: noteId,
      summary_type: summaryType,
      custom_prompt: customPrompt ?? null,
    });
  },

  getNoteSummaries: (noteId: string): Promise<Summary[]> => {
    return invoke("get_note_summaries", { note_id: noteId });
  },

  deleteSummary: (summaryId: number): Promise<void> => {
    return invoke("delete_summary", { summary_id: summaryId });
  },

  // Title generation
  generateTitle: (noteId: string): Promise<string> => {
    return invoke("generate_title", { note_id: noteId });
  },

  // Title generation from summary content
  generateTitleFromSummary: (noteId: string, summaryContent: string): Promise<string> => {
    return invoke("generate_title_from_summary", { note_id: noteId, summary_content: summaryContent });
  },
};
