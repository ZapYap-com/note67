import { invoke } from "@tauri-apps/api/core";
import type { ActionItem, ActionItemWithNote } from "../types";

export const tasksApi = {
  /** Get a note's action items. */
  getActionItems: (noteId: string): Promise<ActionItem[]> => {
    return invoke("get_action_items", { noteId });
  },

  /** Open tasks across all notes (default central Tasks page load). */
  getOpenActionItems: (): Promise<ActionItem[]> => {
    return invoke("get_open_action_items");
  },

  /** A page of completed tasks (newest first), loaded lazily. */
  getCompletedActionItems: (limit: number, offset: number): Promise<ActionItem[]> => {
    return invoke("get_completed_action_items", { limit, offset });
  },

  /** AI-extract action items from a note's transcript + notes into structured rows. */
  extractActionItems: (noteId: string): Promise<ActionItem[]> => {
    return invoke("extract_action_items", { noteId });
  },

  createActionItem: (
    noteId: string | null,
    text: string,
    dueDate: string | null = null,
    parentId: number | null = null,
    description: string | null = null
  ): Promise<ActionItem> => {
    return invoke("create_action_item", { noteId, text, dueDate, parentId, description });
  },

  updateActionItem: (
    id: number,
    text: string,
    description: string | null,
    dueDate: string | null,
    done: boolean
  ): Promise<ActionItem> => {
    return invoke("update_action_item", { id, text, description, dueDate, done });
  },

  setActionItemDone: (id: number, done: boolean): Promise<void> => {
    return invoke("set_action_item_done", { id, done });
  },

  deleteActionItem: (id: number): Promise<void> => {
    return invoke("delete_action_item", { id });
  },

  /** All open action items across every note, for the global Tasks view. */
  listAllOpen: (): Promise<ActionItemWithNote[]> => {
    return invoke("list_all_open_action_items");
  },
};
