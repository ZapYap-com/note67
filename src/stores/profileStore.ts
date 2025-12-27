import { create } from "zustand";
import { settingsApi } from "../api";

export interface UserProfile {
  name: string;
  email: string;
  avatar: string;
}

// Settings key for database storage
const SETTINGS_KEY_PROFILE = "user_profile";

// Legacy localStorage key for migration
const LEGACY_STORAGE_KEY = "note67_profile";

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  email: "",
  avatar: "",
};

// Migrate from localStorage to database (one-time)
async function migrateFromLocalStorage(): Promise<void> {
  try {
    const migrated = localStorage.getItem("note67_profile_migrated");
    if (migrated) return;

    const legacyProfile = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyProfile) {
      await settingsApi.set(SETTINGS_KEY_PROFILE, legacyProfile);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    localStorage.setItem("note67_profile_migrated", "true");
  } catch {
    // Ignore migration errors
  }
}

interface ProfileState {
  profile: UserProfile;
  settingsLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: DEFAULT_PROFILE,
  settingsLoaded: false,

  loadSettings: async () => {
    try {
      await migrateFromLocalStorage();
      const saved = await settingsApi.get(SETTINGS_KEY_PROFILE);
      if (saved) {
        const profile = { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
        set({ profile, settingsLoaded: true });
      } else {
        set({ settingsLoaded: true });
      }
    } catch {
      set({ settingsLoaded: true });
    }
  },

  updateProfile: async (updates: Partial<UserProfile>) => {
    const newProfile = { ...get().profile, ...updates };
    set({ profile: newProfile });
    // Save to database
    try {
      await settingsApi.set(SETTINGS_KEY_PROFILE, JSON.stringify(newProfile));
    } catch {
      // Ignore save errors
    }
  },
}));
