import { invoke } from "@tauri-apps/api/core";
import type { Note, NewNote, UpdateNote, AudioSegment } from "../types";

export const notesApi = {
  create: (input: NewNote): Promise<Note> => {
    return invoke("create_note", { input });
  },

  get: (id: string): Promise<Note | null> => {
    return invoke("get_note", { id });
  },

  list: (): Promise<Note[]> => {
    return invoke("list_notes");
  },

  update: (id: string, update: UpdateNote): Promise<Note> => {
    return invoke("update_note", { id, update });
  },

  search: (query: string): Promise<Note[]> => {
    return invoke("search_notes", { query });
  },

  end: (id: string, audioPath?: string): Promise<void> => {
    return invoke("end_note", { id, audioPath });
  },

  delete: (id: string): Promise<void> => {
    return invoke("delete_note", { id });
  },

  // ========== Pause/Resume/Continue Recording Support ==========

  /** Get all audio segments for a note */
  getAudioSegments: (noteId: string): Promise<AudioSegment[]> => {
    return invoke("get_note_audio_segments", { noteId });
  },

  /** Migrate legacy audio_path to audio_segments table */
  migrateLegacyAudio: (noteId: string): Promise<AudioSegment | null> => {
    return invoke("migrate_legacy_audio", { noteId });
  },
};
