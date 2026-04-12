import { create } from "zustand";
import { tagsApi } from "../api/tags";
import type { Tag } from "../types";

interface TagsState {
  tags: Tag[];
  selectedTag: string | null;
  loading: boolean;
  error: string | null;

  fetchTags: () => Promise<void>;
  selectTag: (tagName: string | null) => void;
  clearSelection: () => void;
  deleteTag: (tagId: number) => Promise<void>;
}

export const useTagsStore = create<TagsState>()((set) => ({
  tags: [],
  selectedTag: null,
  loading: false,
  error: null,

  fetchTags: async () => {
    set({ loading: true, error: null });
    try {
      const tags = await tagsApi.getAll();
      set({ tags, loading: false });
    } catch (error) {
      console.error("Failed to fetch tags:", error);
      set({ error: String(error), loading: false });
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
      const tags = await tagsApi.getAll();
      set({ tags });
    } catch (error) {
      console.error("Failed to delete tag:", error);
      throw error;
    }
  },
}));
