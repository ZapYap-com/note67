import { create } from "zustand";

/**
 * Task state shared by a note's Tasks tab and the central Tasks page.
 *
 * Both load their tasks from the backend when they mount. Bumping
 * `refreshKey` makes a mounted list reload after its tasks change somewhere
 * else, such as tasks being found for a note. It replaces the refresh
 * counter App used to thread through props to views that were never mounted
 * at the same time.
 */
export interface TasksUiState {
  refreshKey: number;
  /** Notes whose tasks are being found right now. */
  extractingNoteIds: string[];

  bumpRefreshKey: () => void;
  setExtracting: (noteId: string, extracting: boolean) => void;
}

const initial = {
  refreshKey: 0,
  extractingNoteIds: [] as string[],
};

export const useTasksUiStore = create<TasksUiState>((set) => ({
  ...initial,
  bumpRefreshKey: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  setExtracting: (noteId, extracting) =>
    set((s) => ({
      extractingNoteIds: extracting
        ? [...s.extractingNoteIds.filter((id) => id !== noteId), noteId]
        : s.extractingNoteIds.filter((id) => id !== noteId),
    })),
}));

/** Restore the initial state — for tests. */
export function resetTasksUiStore() {
  useTasksUiStore.setState({ ...initial });
}
