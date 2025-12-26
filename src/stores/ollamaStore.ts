import { create } from "zustand";
import { aiApi } from "../api";
import type { OllamaModel, OllamaStatus } from "../types";

interface OllamaState {
  status: OllamaStatus | null;
  loading: boolean;
  error: string | null;

  // Derived getters as actions for convenience
  isRunning: () => boolean;
  models: () => OllamaModel[];
  selectedModel: () => string | null;

  // Actions
  checkStatus: () => Promise<void>;
  selectModel: (modelName: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useOllamaStore = create<OllamaState>((set, get) => ({
  status: null,
  loading: true,
  error: null,

  isRunning: () => get().status?.running ?? false,
  models: () => get().status?.models ?? [],
  selectedModel: () => get().status?.selected_model ?? null,

  checkStatus: async () => {
    try {
      set({ loading: true });
      const status = await aiApi.getOllamaStatus();
      set({ status, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  selectModel: async (modelName: string) => {
    try {
      await aiApi.selectModel(modelName);
      await get().checkStatus();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  setError: (error) => set({ error }),
}));
