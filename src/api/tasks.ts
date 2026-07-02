import { invoke } from "@tauri-apps/api/core";
import type { ActionItem, ActionItemWithNote } from "../types";

export const tasksApi = {
  /** Get a note's action items. */
  getActionItems: (noteId: string): Promise<ActionItem[]> => {
    return invoke("get_action_items", { noteId });
  },

  /** AI-extract action items from a note's transcript + notes into structured rows. */
  extractActionItems: (noteId: string): Promise<ActionItem[]> => {
    return invoke("extract_action_items", { noteId });
  },

  createActionItem: (
    noteId: string,
    text: string,
    assignee: string | null,
    dueDate: string | null
  ): Promise<ActionItem> => {
    return invoke("create_action_item", { noteId, text, assignee, dueDate });
  },

  updateActionItem: (
    id: number,
    text: string,
    assignee: string | null,
    dueDate: string | null,
    done: boolean
  ): Promise<ActionItem> => {
    return invoke("update_action_item", { id, text, assignee, dueDate, done });
  },

  deleteActionItem: (id: number): Promise<void> => {
    return invoke("delete_action_item", { id });
  },

  /** All open action items across every note, for the global Tasks view. */
  listAllOpen: (): Promise<ActionItemWithNote[]> => {
    return invoke("list_all_open_action_items");
  },
};
