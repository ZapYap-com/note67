import { invoke } from "@tauri-apps/api/core";
import type { BacklinkNote } from "../types";

export const linksApi = {
  /** Get backlinks - notes that link TO this note */
  getBacklinks: (noteId: string): Promise<BacklinkNote[]> => {
    return invoke("get_backlinks", { noteId });
  },

  /** Search notes by title for autocomplete */
  searchNotesByTitle: (query: string): Promise<BacklinkNote[]> => {
    return invoke("search_notes_by_title", { query });
  },

};
