import { invoke } from "@tauri-apps/api/core";
import type { Tag, NoteTag, Note } from "../types";

export const tagsApi = {
  /** Get all tags with note counts */
  getAll: (): Promise<Tag[]> => {
    return invoke("get_all_tags");
  },

  /** Get tags for a specific note */
  getForNote: (noteId: string): Promise<NoteTag[]> => {
    return invoke("get_note_tags", { noteId });
  },

  /** Get all note-tag mappings (for inline display) */
  getAllNoteTags: (): Promise<Record<string, NoteTag[]>> => {
    return invoke("get_all_note_tags");
  },

  /** Sync note tags based on content (extracts #tags from content) */
  syncNoteTags: (noteId: string, content: string): Promise<void> => {
    return invoke("sync_note_tags", { noteId, content });
  },

  /** Get notes filtered by tag name */
  getNotesByTag: (tagName: string): Promise<Note[]> => {
    return invoke("get_notes_by_tag", { tagName });
  },

  /** Delete a tag globally */
  deleteTag: (tagId: number): Promise<void> => {
    return invoke("delete_tag", { tagId });
  },
};
