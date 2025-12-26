import { create } from "zustand";
import { aiApi } from "../api";
import type { OllamaModel, OllamaStatus } from "../types";

const STORAGE_KEY = "note67_ollama_model";

function getSavedModel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveModel(model: string | null): void {
  try {
    if (model) {
      localStorage.setItem(STORAGE_KEY, model);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

interface OllamaState {
  status: OllamaStatus | null;
  loading: boolean;
  error: string | null;
  initialized: boolean;

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
  initialized: false,

  isRunning: () => get().status?.running ?? false,
  models: () => get().status?.models ?? [],
  selectedModel: () => get().status?.selected_model ?? null,

  checkStatus: async () => {
    try {
      set({ loading: true });
      const status = await aiApi.getOllamaStatus();
      set({ status, error: null });

      // Auto-select saved model on first init if no model is selected
      const { initialized } = get();
      if (!initialized) {
        set({ initialized: true });
        const savedModel = getSavedModel();
        if (savedModel && status.running && !status.selected_model) {
          // Check if saved model is available
          const modelExists = status.models.some((m) => m.name === savedModel);
          if (modelExists) {
            get().selectModel(savedModel);
          }
        }
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  selectModel: async (modelName: string) => {
    try {
      await aiApi.selectModel(modelName);
      saveModel(modelName);
      await get().checkStatus();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  setError: (error) => set({ error }),
}));
