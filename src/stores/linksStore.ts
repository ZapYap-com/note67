import { create } from "zustand";
import { linksApi } from "../api/links";
import type { BacklinkNote } from "../types";

interface LinksState {
  backlinks: BacklinkNote[];
  loading: boolean;
  error: string | null;
  currentNoteId: string | null;

  fetchBacklinks: (noteId: string) => Promise<void>;
  clearBacklinks: () => void;
}

export const useLinksStore = create<LinksState>()((set, get) => ({
  backlinks: [],
  loading: false,
  error: null,
  currentNoteId: null,

  fetchBacklinks: async (noteId: string) => {
    // Skip if already loading this note
    if (get().currentNoteId === noteId && get().loading) {
      return;
    }

    set({ loading: true, error: null, currentNoteId: noteId });
    try {
      const backlinks = await linksApi.getBacklinks(noteId);
      // Only update if this is still the current note
      if (get().currentNoteId === noteId) {
        set({ backlinks, loading: false });
      }
    } catch (error) {
      console.error("Failed to fetch backlinks:", error);
      if (get().currentNoteId === noteId) {
        set({ error: String(error), loading: false });
      }
    }
  },

  clearBacklinks: () => {
    set({ backlinks: [], currentNoteId: null, error: null });
  },
}));
