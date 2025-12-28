import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface MeetingDetected {
  app_name: string;
  bundle_id: string | null;
  is_browser: boolean;
}

interface MeetingStore {
  // State
  detectedMeeting: MeetingDetected | null;
  isEnabled: boolean;
  dismissed: boolean;

  // Actions
  setDetectedMeeting: (meeting: MeetingDetected | null) => void;
  dismissMeeting: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  loadEnabled: () => Promise<void>;
}

export const useMeetingStore = create<MeetingStore>((set) => ({
  detectedMeeting: null,
  isEnabled: true,
  dismissed: false,

  setDetectedMeeting: (meeting) => set({ detectedMeeting: meeting, dismissed: false }),

  dismissMeeting: () => {
    set({ dismissed: true });
    // Don't clear detection cache - prevents popup from showing again for same meeting
    // New/different meetings will still trigger (they have different window titles)
  },

  setEnabled: async (enabled) => {
    try {
      await invoke("set_meeting_detection_enabled", { enabled });
      set({ isEnabled: enabled });
    } catch (error) {
      console.error("Failed to set meeting detection enabled:", error);
    }
  },

  loadEnabled: async () => {
    try {
      const enabled = await invoke<boolean>("is_meeting_detection_enabled");
      set({ isEnabled: enabled });
    } catch (error) {
      console.error("Failed to load meeting detection enabled:", error);
    }
  },
}));
