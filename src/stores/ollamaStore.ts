import { create } from "zustand";
import { aiApi, settingsApi } from "../api";
import type { OllamaModel, OllamaStatus } from "../types";

// Settings key for database storage
const SETTINGS_KEY_MODEL = "ollama_model";

// Legacy localStorage key for migration
const LEGACY_STORAGE_KEY = "note67_ollama_model";

// Migrate from localStorage to database (one-time)
async function migrateFromLocalStorage(): Promise<void> {
  try {
    const migrated = localStorage.getItem("note67_ollama_migrated");
    if (migrated) return;

    const legacyModel = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyModel) {
      await settingsApi.set(SETTINGS_KEY_MODEL, legacyModel);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    localStorage.setItem("note67_ollama_migrated", "true");
  } catch {
    // Ignore migration errors
  }
}

interface OllamaState {
  status: OllamaStatus | null;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  settingsLoaded: boolean;
  savedModel: string | null;

  // Derived getters as actions for convenience
  isRunning: () => boolean;
  models: () => OllamaModel[];
  selectedModel: () => string | null;

  // Actions
  loadSettings: () => Promise<void>;
  checkStatus: () => Promise<void>;
  selectModel: (modelName: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useOllamaStore = create<OllamaState>((set, get) => ({
  status: null,
  loading: true,
  error: null,
  initialized: false,
  settingsLoaded: false,
  savedModel: null,

  isRunning: () => get().status?.running ?? false,
  models: () => get().status?.models ?? [],
  selectedModel: () => get().status?.selected_model ?? null,

  loadSettings: async () => {
    try {
      await migrateFromLocalStorage();
      const savedModel = await settingsApi.get(SETTINGS_KEY_MODEL);
      set({ savedModel, settingsLoaded: true });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  checkStatus: async () => {
    try {
      set({ loading: true });
      const status = await aiApi.getOllamaStatus();
      set({ status, error: null });

      // Auto-select saved model on first init if no model is selected
      const { initialized, savedModel } = get();
      if (!initialized) {
        set({ initialized: true });
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
      set({ savedModel: modelName });
      // Save to database
      await settingsApi.set(SETTINGS_KEY_MODEL, modelName);
      await get().checkStatus();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  setError: (error) => set({ error }),
}));
