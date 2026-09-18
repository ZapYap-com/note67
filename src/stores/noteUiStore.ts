import { create } from "zustand";

export type NoteTab = "note" | "transcript" | "summary" | "tasks";

/**
 * View state for the note pane.
 *
 * Unlike the recording/transcription stores this is not lifted domain state —
 * it is genuinely UI state. It lives here because both App and NoteView drive
 * it: App switches tabs when starting a recording or navigating in from the
 * graph/Tasks views, while NoteView switches them from the tab bar. Threading
 * that through props meant a value and a setter prop for each one.
 */
export interface NoteUiState {
  activeTab: NoteTab;
  editingTitle: boolean;
  showAISidebar: boolean;
  /** Task to focus when the note is opened from the global Tasks view. */
  focusTaskId: number | null;
  /**
   * Saves the open note's body right away if it has unsaved edits. The editor
   * debounces saves by 1.5 s, so anything that reads the body back from the
   * database (stopping a recording, summarizing) flushes first. Registered by
   * NoteView; call it through `flushPendingNoteSave`.
   */
  flushNoteSave: (() => Promise<void>) | null;

  setActiveTab: (tab: NoteTab) => void;
  setEditingTitle: (editing: boolean) => void;
  toggleAISidebar: () => void;
  setShowAISidebar: (show: boolean) => void;
  setFocusTaskId: (id: number | null) => void;
  setFlushNoteSave: (flush: (() => Promise<void>) | null) => void;
}

const initial = {
  activeTab: "summary" as NoteTab,
  editingTitle: false,
  showAISidebar: false,
  focusTaskId: null as number | null,
  flushNoteSave: null as (() => Promise<void>) | null,
};

export const useNoteUiStore = create<NoteUiState>((set) => ({
  ...initial,
  setActiveTab: (activeTab) => set({ activeTab }),
  setEditingTitle: (editingTitle) => set({ editingTitle }),
  toggleAISidebar: () => set((state) => ({ showAISidebar: !state.showAISidebar })),
  setShowAISidebar: (showAISidebar) => set({ showAISidebar }),
  setFocusTaskId: (focusTaskId) => set({ focusTaskId }),
  setFlushNoteSave: (flushNoteSave) => set({ flushNoteSave }),
}));

/**
 * Save the open note's pending edits now, if there are any. Never throws:
 * a failed save stays pending for the editor to retry, and what called this
 * (a Stop, a summary) goes ahead with what's saved. A rejected flush used
 * to abort the Stop before the recording stopped.
 */
export async function flushPendingNoteSave(): Promise<void> {
  try {
    await useNoteUiStore.getState().flushNoteSave?.();
  } catch (e) {
    console.error("Saving the note first failed:", e);
  }
}

/** Restore the initial state — for tests. */
export function resetNoteUiStore() {
  useNoteUiStore.setState({ ...initial });
}
