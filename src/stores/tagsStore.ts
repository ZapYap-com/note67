import { create } from "zustand";
import { tagsApi } from "../api/tags";
import type { Tag, NoteTag } from "../types";

interface TagsState {
  tags: Tag[];
  noteTagsMap: Record<string, NoteTag[]>;
  selectedTag: string | null;
  loading: boolean;
  error: string | null;

  fetchTags: () => Promise<void>;
  fetchNoteTags: () => Promise<void>;
  selectTag: (tagName: string | null) => void;
  clearSelection: () => void;
  deleteTag: (tagId: number) => Promise<void>;
  getTagsForNote: (noteId: string) => NoteTag[];
}

export const useTagsStore = create<TagsState>()((set, get) => ({
  tags: [],
  noteTagsMap: {},
  selectedTag: null,
  loading: false,
  error: null,

  fetchTags: async () => {
    set({ loading: true, error: null });
    try {
      const [tags, noteTagsMap] = await Promise.all([
        tagsApi.getAll(),
        tagsApi.getAllNoteTags(),
      ]);
      set({ tags, noteTagsMap, loading: false });
    } catch (error) {
      console.error("Failed to fetch tags:", error);
      set({ error: String(error), loading: false });
    }
  },

  fetchNoteTags: async () => {
    try {
      const noteTagsMap = await tagsApi.getAllNoteTags();
      set({ noteTagsMap });
    } catch (error) {
      console.error("Failed to fetch note tags:", error);
    }
  },

  selectTag: (tagName: string | null) => {
    set({ selectedTag: tagName });
  },

  clearSelection: () => {
    set({ selectedTag: null });
  },

  deleteTag: async (tagId: number) => {
    try {
      await tagsApi.deleteTag(tagId);
      // Refresh tags after deletion
      const [tags, noteTagsMap] = await Promise.all([
        tagsApi.getAll(),
        tagsApi.getAllNoteTags(),
      ]);
      set({ tags, noteTagsMap });
    } catch (error) {
      console.error("Failed to delete tag:", error);
      throw error;
    }
  },

  getTagsForNote: (noteId: string) => {
    return get().noteTagsMap[noteId] || [];
  },
}));
