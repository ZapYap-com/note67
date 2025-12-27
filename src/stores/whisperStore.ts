import { create } from "zustand";
import { transcriptionApi } from "../api";
import type { ModelInfo, ModelSize } from "../types";

const STORAGE_KEY = "note67_whisper_model";
const LANGUAGE_STORAGE_KEY = "note67_whisper_language";

export type WhisperLanguage = "auto" | string;

// Common languages supported by Whisper (subset of ~99 total)
export const WHISPER_LANGUAGES: { code: WhisperLanguage; name: string }[] = [
  { code: "auto", name: "Auto-detect" },
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
];

function getSavedModel(): ModelSize | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved as ModelSize | null;
  } catch {
    return null;
  }
}

function saveModel(model: ModelSize | null): void {
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

function getSavedLanguage(): WhisperLanguage {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved || "auto";
  } catch {
    return "auto";
  }
}

function saveLanguage(language: WhisperLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage errors
  }
}

interface WhisperState {
  models: ModelInfo[];
  loadedModel: ModelSize | null;
  isDownloading: boolean;
  downloadingModel: ModelSize | null;
  downloadProgress: number;
  error: string | null;
  progressInterval: number | null;
  initialized: boolean;
  language: WhisperLanguage;

  // Actions
  refreshModels: () => Promise<void>;
  downloadModel: (size: ModelSize) => Promise<void>;
  deleteModel: (size: ModelSize) => Promise<void>;
  loadModel: (size: ModelSize) => Promise<void>;
  setError: (error: string | null) => void;
  setLanguage: (language: WhisperLanguage) => void;
}

export const useWhisperStore = create<WhisperState>((set, get) => ({
  models: [],
  loadedModel: null,
  isDownloading: false,
  downloadingModel: null,
  downloadProgress: 0,
  error: null,
  progressInterval: null,
  initialized: false,
  language: getSavedLanguage(),

  refreshModels: async () => {
    try {
      const [modelList, loaded] = await Promise.all([
        transcriptionApi.listModels(),
        transcriptionApi.getLoadedModel(),
      ]);
      set({ models: modelList, loadedModel: loaded, error: null });

      // Auto-load saved model on first init if no model is loaded
      const { initialized } = get();
      if (!initialized) {
        set({ initialized: true });
        const savedModel = getSavedModel();
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
      set({ loadedModel: size });
      saveModel(size);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setError: (error) => set({ error }),

  setLanguage: (language) => {
    saveLanguage(language);
    set({ language });
  },
}));
