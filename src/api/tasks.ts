import { invoke } from "@tauri-apps/api/core";
import type { ActionItem, ActionItemWithNote } from "../types";

export const tasksApi = {
  /** Get a note's action items. */
  getActionItems: (noteId: string): Promise<ActionItem[]> => {
    return invoke("get_action_items", { noteId });
  },

  /** Get every action item across all notes (central Tasks page). */
  getAllActionItems: (): Promise<ActionItem[]> => {
    return invoke("get_all_action_items");
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
