import { create } from "zustand";

export type RecordingStatus = "idle" | "recording" | "paused" | "processing";

interface Note {
  id: string;
  title: string;
  startedAt: Date;
  endedAt?: Date;
}

interface AppState {
  // Recording state
  recordingStatus: RecordingStatus;
  currentNote: Note | null;
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
  currentNote: null,
  audioLevel: 0,

  // Actions
  startRecording: (title) =>
    set({
      recordingStatus: "recording",
      currentNote: {
        id: crypto.randomUUID(),
        title: title || `Note ${new Date().toLocaleString()}`,
        startedAt: new Date(),
      },
    }),

  stopRecording: () =>
    set((state) => ({
      recordingStatus: "processing",
      currentNote: state.currentNote
        ? { ...state.currentNote, endedAt: new Date() }
        : null,
    })),

  pauseRecording: () => set({ recordingStatus: "paused" }),

  resumeRecording: () => set({ recordingStatus: "recording" }),

  setAudioLevel: (level) => set({ audioLevel: level }),
}));
