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
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Audio",
          extensions: ["mp3", "m4a", "wav", "webm", "ogg", "flac", "aac", "wma"],
        },
      ],
    });

    if (!selected) return null;

    return invoke<UploadedAudio>("upload_audio", {
      noteId,
      sourcePath: selected,
      speakerLabel,
    });
  },

  /**
   * Upload an audio file from a known path (without file picker).
   */
  upload: (
    noteId: string,
    sourcePath: string,
    speakerLabel?: string
  ): Promise<UploadedAudio> => {
    return invoke<UploadedAudio>("upload_audio", {
      noteId,
      sourcePath,
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
   * Update the speaker label for an uploaded audio file.
   */
  updateSpeaker: (uploadId: number, speakerLabel: string): Promise<void> => {
    return invoke("update_uploaded_audio_speaker", { uploadId, speakerLabel });
  },
};
