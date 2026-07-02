import type { Dispatch, SetStateAction } from "react";
import { tasksApi } from "../../api";
import type { ActionItem } from "../../types";

/**
 * Shared task CRUD used by both the per-note Tasks tab and the central Tasks
 * page. Operates on a local `items` array (optimistically) + the backend.
 */
export function useTaskMutations(
  items: ActionItem[],
  setItems: Dispatch<SetStateAction<ActionItem[]>>,
  onChanged?: () => void
) {
  const patchLocal = (id: number, patch: Partial<ActionItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const persist = async (item: ActionItem) => {
    try {
      await tasksApi.updateActionItem(
        item.id,
        item.text,
        item.description,
        item.due_date,
        item.done
      );
      onChanged?.();
    } catch (e) {
      console.error("Failed to update task:", e);
    }
  };

  const persistById = (id: number) => {
    const item = items.find((i) => i.id === id);
    if (item) persist(item);
  };

  const toggleDone = async (item: ActionItem) => {
    patchLocal(item.id, { done: !item.done });
    await persist({ ...item, done: !item.done });
  };

  const remove = async (id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_id !== id));
    try {
      await tasksApi.deleteActionItem(id);
      onChanged?.();
    } catch (e) {
      console.error("Failed to delete task:", e);
    }
  };

  const addSubtask = async (noteId: string, parentId: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const created = await tasksApi.createActionItem(noteId, trimmed, null, parentId);
      setItems((prev) => [...prev, created]);
      onChanged?.();
    } catch (e) {
      console.error("Failed to create subtask:", e);
    }
  };

  return { patchLocal, persist, persistById, toggleDone, remove, addSubtask };
}
