import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { tasksApi } from "../../api";
import type { ActionItem } from "../../types";

/** A deleted task and its subtasks, kept long enough to undo the delete. */
export interface DeletedTask {
  item: ActionItem;
  subtasks: ActionItem[];
}

/**
 * Shared task CRUD used by both the per-note Tasks tab and the central Tasks
 * page. Operates on a local `items` array (optimistically) + the backend.
 */
export function useTaskMutations(
  items: ActionItem[],
  setItems: Dispatch<SetStateAction<ActionItem[]>>
) {
  // Tasks edited locally since they were last saved. The detail pane saves on
  // every blur; without this, tabbing through its fields rewrote an unchanged
  // task each time and bumped its updated_at, which orders the completed list.
  const dirty = useRef(new Set<number>());
  const [deleted, setDeleted] = useState<DeletedTask | null>(null);

  const patchLocal = (id: number, patch: Partial<ActionItem>) => {
    dirty.current.add(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const persist = async (item: ActionItem) => {
    dirty.current.delete(item.id);
    try {
      await tasksApi.updateActionItem(
        item.id,
        item.text,
        item.description,
        item.due_date,
        item.done
      );
    } catch (e) {
      console.error("Failed to update task:", e);
    }
  };

  /** Save a task's local edits, if it has any. */
  const persistById = (id: number) => {
    if (!dirty.current.has(id)) return;
    const item = items.find((i) => i.id === id);
    if (item) void persist(item);
  };

  const toggleDone = async (item: ActionItem) => {
    patchLocal(item.id, { done: !item.done });
    await persist({ ...item, done: !item.done });
  };

  const remove = async (id: number) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const subtasks = items.filter((i) => i.parent_id === id);
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_id !== id));
    try {
      await tasksApi.deleteActionItem(id);
      setDeleted({ item, subtasks });
    } catch (e) {
      console.error("Failed to delete task:", e);
      setItems((prev) => [...prev, item, ...subtasks]);
    }
  };

  /**
   * Bring back the last deleted task and its subtasks. They are created
   * again, so they get new ids and go to the end of the list.
   */
  const undoDelete = async () => {
    if (!deleted) return;
    const { item, subtasks } = deleted;
    setDeleted(null);
    try {
      const recreate = async (task: ActionItem, parentId: number | null) => {
        const created = await tasksApi.createActionItem(
          task.note_id,
          task.text,
          task.due_date,
          parentId,
          task.description
        );
        return task.done
          ? tasksApi.updateActionItem(
              created.id,
              created.text,
              created.description,
              created.due_date,
              true
            )
          : created;
      };
      // A deleted subtask goes back under its parent.
      const parent = await recreate(item, item.parent_id);
      const restored = [parent];
      for (const sub of subtasks) restored.push(await recreate(sub, parent.id));
      setItems((prev) => [...prev, ...restored]);
    } catch (e) {
      console.error("Failed to restore task:", e);
    }
  };

  // Stable, so the toast's auto-dismiss timer doesn't restart on every render.
  const dismissDeleted = useCallback(() => setDeleted(null), []);

  const addSubtask = async (noteId: string | null, parentId: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const created = await tasksApi.createActionItem(noteId, trimmed, null, parentId);
      setItems((prev) => [...prev, created]);
    } catch (e) {
      console.error("Failed to create subtask:", e);
    }
  };

  return {
    patchLocal,
    persist,
    persistById,
    toggleDone,
    remove,
    addSubtask,
    deleted,
    undoDelete,
    dismissDeleted,
  };
}
