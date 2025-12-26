import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export interface ExportData {
  markdown: string;
  filename: string;
}

export const exportApi = {
  exportMarkdown: (noteId: string): Promise<ExportData> => {
    return invoke("export_note_markdown", { noteId });
  },

  saveToFile: (content: string, filename: string): Promise<string> => {
    return invoke("save_export_to_file", { content, filename });
  },

  getExportDirectory: (): Promise<string> => {
    return invoke("get_export_directory");
  },

  copyToClipboard: async (text: string): Promise<void> => {
    await writeText(text);
  },
};
