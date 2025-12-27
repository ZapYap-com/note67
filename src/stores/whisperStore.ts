import { create } from "zustand";
import { settingsApi, transcriptionApi } from "../api";
import type { ModelInfo, ModelSize } from "../types";

// Settings keys for database storage
const SETTINGS_KEY_MODEL = "whisper_model";
const SETTINGS_KEY_LANGUAGE = "whisper_language";

// Legacy localStorage keys for migration
const LEGACY_STORAGE_KEY = "note67_whisper_model";
const LEGACY_LANGUAGE_STORAGE_KEY = "note67_whisper_language";

export type WhisperLanguage = "auto" | string;

// Common languages supported by Whisper (subset of ~99 total)
export const WHISPER_LANGUAGES: { code: WhisperLanguage; name: string }[] = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "tl", name: "Tagalog" },
  { code: "auto", name: "Auto-detect (not recommended)" },
];

// Migrate from localStorage to database (one-time)
async function migrateFromLocalStorage(): Promise<void> {
  try {
    // Check if migration already done
    const migrated = localStorage.getItem("note67_whisper_migrated");
    if (migrated) return;

    // Migrate model setting
    const legacyModel = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyModel) {
      await settingsApi.set(SETTINGS_KEY_MODEL, legacyModel);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    // Migrate language setting
    const legacyLanguage = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
    if (legacyLanguage) {
      await settingsApi.set(SETTINGS_KEY_LANGUAGE, legacyLanguage);
      localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
    }

    // Mark migration as done
    localStorage.setItem("note67_whisper_migrated", "true");
  } catch {
    // Ignore migration errors
  }
}

interface WhisperState {
  models: ModelInfo[];
  loadedModel: ModelSize | null;
  savedModel: ModelSize | null;
  isDownloading: boolean;
  downloadingModel: ModelSize | null;
  downloadProgress: number;
  error: string | null;
  progressInterval: number | null;
  initialized: boolean;
  settingsLoaded: boolean;
  language: WhisperLanguage;

  // Actions
  loadSettings: () => Promise<void>;
  refreshModels: () => Promise<void>;
  downloadModel: (size: ModelSize) => Promise<void>;
  deleteModel: (size: ModelSize) => Promise<void>;
  loadModel: (size: ModelSize) => Promise<void>;
  setError: (error: string | null) => void;
  setLanguage: (language: WhisperLanguage) => Promise<void>;
}

export const useWhisperStore = create<WhisperState>((set, get) => ({
  models: [],
  loadedModel: null,
  savedModel: null,
  isDownloading: false,
  downloadingModel: null,
  downloadProgress: 0,
  error: null,
  progressInterval: null,
  initialized: false,
  settingsLoaded: false,
  language: "en",

  loadSettings: async () => {
    try {
      // Run migration first
      await migrateFromLocalStorage();

      // Load settings from database
      const settings = await settingsApi.getMultiple([SETTINGS_KEY_MODEL, SETTINGS_KEY_LANGUAGE]);
      const savedModel = settings[SETTINGS_KEY_MODEL] as ModelSize | null;
      const language = settings[SETTINGS_KEY_LANGUAGE] || "en";

      set({ savedModel, language, settingsLoaded: true });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  refreshModels: async () => {
    try {
      const [modelList, loaded] = await Promise.all([
        transcriptionApi.listModels(),
        transcriptionApi.getLoadedModel(),
      ]);
      set({ models: modelList, loadedModel: loaded, error: null });

      // Auto-load saved model on first init if no model is loaded
      const { initialized, savedModel } = get();
      if (!initialized) {
        set({ initialized: true });
        if (savedModel && !loaded) {
          // Check if saved model is downloaded
          const savedModelInfo = modelList.find((m) => m.size === savedModel);
          if (savedModelInfo?.downloaded) {
            get().loadModel(savedModel);
          }
        }
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  downloadModel: async (size: ModelSize) => {
    try {
      set({ error: null, isDownloading: true, downloadingModel: size, downloadProgress: 0 });

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
      set({ isDownloading: false, downloadingModel: null, downloadProgress: 0, progressInterval: null });
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
      set({ loadedModel: size, savedModel: size });
      // Save to database
      await settingsApi.set(SETTINGS_KEY_MODEL, size);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setError: (error) => set({ error }),

  setLanguage: async (language) => {
    set({ language });
    // Save to database
    try {
      await settingsApi.set(SETTINGS_KEY_LANGUAGE, language);
    } catch {
      // Ignore save errors
    }
  },
}));
