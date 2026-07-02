import { invoke } from "@tauri-apps/api/core";
import type { ActionItemInput, ActionItemWithNote } from "../types";

export const tasksApi = {
  /** Ask the AI for an inline GFM checklist of action items for a note. */
  extractActionItems: (noteId: string): Promise<string> => {
    return invoke("extract_action_items", { noteId });
  },

  /** Sync a note's parsed inline action items into the queryable index. */
  syncActionItems: (noteId: string, items: ActionItemInput[]): Promise<void> => {
    return invoke("sync_action_items", { noteId, items });
  },

  /** All open action items across every note, for the global Tasks view. */
  listAllOpen: (): Promise<ActionItemWithNote[]> => {
    return invoke("list_all_open_action_items");
  },
};
