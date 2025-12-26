import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export interface ExportData {
  markdown: string;
  filename: string;
}

export const exportApi = {
  exportMarkdown: (noteId: string): Promise<ExportData> => {
    return invoke("export_note_markdown", { noteId });
  },

  saveToFileWithDialog: async (content: string, defaultFilename: string): Promise<string | null> => {
    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (filePath) {
      await writeTextFile(filePath, content);
      return filePath;
    }
    return null;
  },

  copyToClipboard: async (text: string): Promise<void> => {
    await writeText(text);
  },
};
