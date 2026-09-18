import { invoke } from "@tauri-apps/api/core";
import type { Tag, NoteTag, Note } from "../types";

export const tagsApi = {
  /** Get all tags with note counts */
  getAll: (): Promise<Tag[]> => {
    return invoke("get_all_tags");
  },

  /** Get all note-tag mappings (for inline display) */
  getAllNoteTags: (): Promise<Record<string, NoteTag[]>> => {
    return invoke("get_all_note_tags");
  },

  /** Get notes filtered by tag name */
  getNotesByTag: (tagName: string): Promise<Note[]> => {
    return invoke("get_notes_by_tag", { tagName });
  },

};
