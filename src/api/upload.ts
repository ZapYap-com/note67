import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { UploadedAudio } from "../types";

export const uploadApi = {
  /**
   * Open file picker and upload an audio file for a note.
   * The file will be converted to WAV format for transcription.
   */
  selectAndUpload: async (
    noteId: string,
    speakerLabel?: string
  ): Promise<UploadedAudio | null> => {
    // The backend's list, so the picker never offers what import rejects.
    const extensions = await invoke<string[]>("supported_audio_formats");
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions }],
    });

    if (!selected) return null;

    return invoke<UploadedAudio>("upload_audio", {
      noteId,
      sourcePath: selected,
      speakerLabel,
    });
  },

  /**
   * Get all uploaded audio files for a note.
   */
  getUploads: (noteId: string): Promise<UploadedAudio[]> => {
    return invoke<UploadedAudio[]>("get_uploaded_audio", { noteId });
  },

  /**
   * Delete an uploaded audio file.
   */
  delete: (uploadId: number): Promise<void> => {
    return invoke("delete_uploaded_audio", { uploadId });
  },

  /**
   * Transcribe an uploaded audio file.
   * Returns the number of transcript segments created.
   */
  transcribe: (uploadId: number): Promise<number> => {
    return invoke<number>("transcribe_uploaded_audio", { uploadId });
  },

  /**
   * Reorder audio items for a note.
   */
  reorderItems: (
    items: Array<{ item_type: string; id: number; order: number }>
  ): Promise<void> => {
    return invoke("reorder_audio_items", { items });
  },
};
