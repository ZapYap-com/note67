import { create } from "zustand";
import { transcriptionApi } from "../api";
import type { ModelInfo, ModelSize } from "../types";

interface WhisperState {
  models: ModelInfo[];
  loadedModel: ModelSize | null;
  isDownloading: boolean;
  downloadProgress: number;
  error: string | null;
  progressInterval: number | null;

  // Actions
  refreshModels: () => Promise<void>;
  downloadModel: (size: ModelSize) => Promise<void>;
  deleteModel: (size: ModelSize) => Promise<void>;
  loadModel: (size: ModelSize) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useWhisperStore = create<WhisperState>((set, get) => ({
  models: [],
  loadedModel: null,
  isDownloading: false,
  downloadProgress: 0,
  error: null,
  progressInterval: null,

  refreshModels: async () => {
    try {
      const [modelList, loaded] = await Promise.all([
        transcriptionApi.listModels(),
        transcriptionApi.getLoadedModel(),
      ]);
      set({ models: modelList, loadedModel: loaded, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  downloadModel: async (size: ModelSize) => {
    try {
      set({ error: null, isDownloading: true, downloadProgress: 0 });

      // Start polling progress
      const interval = window.setInterval(async () => {
        try {
          const progress = await transcriptionApi.getDownloadProgress();
          set({ downloadProgress: progress });
        } catch {
          // Ignore errors during polling
        }
      }, 500);
      set({ progressInterval: interval });

      await transcriptionApi.downloadModel(size);
      await get().refreshModels();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      const { progressInterval } = get();
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      set({ isDownloading: false, downloadProgress: 0, progressInterval: null });
    }
  },

  deleteModel: async (size: ModelSize) => {
    try {
      set({ error: null });
      await transcriptionApi.deleteModel(size);
      await get().refreshModels();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadModel: async (size: ModelSize) => {
    try {
      set({ error: null });
      await transcriptionApi.loadModel(size);
      set({ loadedModel: size });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setError: (error) => set({ error }),
}));
