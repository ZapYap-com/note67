import { create } from "zustand";

export interface UserProfile {
  name: string;
  email: string;
  avatar: string;
}

const STORAGE_KEY = "note67_profile";

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  email: "",
  avatar: "",
};

function loadProfile(): UserProfile {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Failed to load profile:", e);
  }
  return DEFAULT_PROFILE;
}

function saveProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage errors
  }
}

interface ProfileState {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: loadProfile(),

  updateProfile: (updates: Partial<UserProfile>) => {
    const newProfile = { ...get().profile, ...updates };
    set({ profile: newProfile });
    saveProfile(newProfile);
  },
}));
