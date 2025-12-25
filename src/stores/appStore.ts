import { create } from "zustand";

export type RecordingStatus = "idle" | "recording" | "paused" | "processing";

interface Meeting {
  id: string;
  title: string;
  startedAt: Date;
  endedAt?: Date;
}

interface AppState {
  // Recording state
  recordingStatus: RecordingStatus;
  currentMeeting: Meeting | null;
  audioLevel: number;

  // Actions
  startRecording: (title?: string) => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  setAudioLevel: (level: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  recordingStatus: "idle",
  currentMeeting: null,
  audioLevel: 0,

  // Actions
  startRecording: (title) =>
    set({
      recordingStatus: "recording",
      currentMeeting: {
        id: crypto.randomUUID(),
        title: title || `Meeting ${new Date().toLocaleString()}`,
        startedAt: new Date(),
      },
    }),

  stopRecording: () =>
    set((state) => ({
      recordingStatus: "processing",
      currentMeeting: state.currentMeeting
        ? { ...state.currentMeeting, endedAt: new Date() }
        : null,
    })),

  pauseRecording: () => set({ recordingStatus: "paused" }),

  resumeRecording: () => set({ recordingStatus: "recording" }),

  setAudioLevel: (level) => set({ audioLevel: level }),
}));
