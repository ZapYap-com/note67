import { invoke } from "@tauri-apps/api/core";
import type { NoteLink, BacklinkNote, UnlinkedMention } from "../types";

export const linksApi = {
  /** Get backlinks - notes that link TO this note */
  getBacklinks: (noteId: string): Promise<BacklinkNote[]> => {
    return invoke("get_backlinks", { noteId });
  },

  /** Get links FROM this note */
  getNoteLinks: (noteId: string): Promise<NoteLink[]> => {
    return invoke("get_note_links", { noteId });
  },

  /** Search notes by title for autocomplete */
  searchNotesByTitle: (query: string): Promise<BacklinkNote[]> => {
    return invoke("search_notes_by_title", { query });
  },

  /** Get broken link titles - links that don't have a matching target note */
  getBrokenLinkTitles: (noteId: string): Promise<string[]> => {
    return invoke("get_broken_link_titles", { noteId });
  },

  /** Get unlinked mentions - notes that mention this note's title without [[]] */
  getUnlinkedMentions: (noteId: string): Promise<UnlinkedMention[]> => {
    return invoke("get_unlinked_mentions", { noteId });
  },
};
