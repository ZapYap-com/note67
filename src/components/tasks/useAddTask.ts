import { useRef, useState } from "react";
import { tasksApi } from "../../api";
import type { ActionItem } from "../../types";

/**
 * The "Add a task…" row, shared by a note's Tasks tab and the Tasks page.
 *
 * Enter and blur both add, so adding is single-flight and the draft clears
 * before the request: it used to clear only once the IPC resolved, so
 * pressing Enter and then clicking away created the task twice.
 *
 * New tasks get no due date. Defaulting to today put every hand-added task
 * that wasn't finished the same day into Overdue, which drowned out the
 * tasks that really were.
 */
export function useAddTask(
  noteId: string | null,
  onCreated: (item: ActionItem) => void
) {
  const [draft, setDraft] = useState("");
  const inFlight = useRef(false);

  const add = async () => {
    const text = draft.trim();
    if (!text || inFlight.current) return;
    inFlight.current = true;
    setDraft("");
    try {
      onCreated(await tasksApi.createActionItem(noteId, text));
    } catch (e) {
      console.error("Failed to create task:", e);
      setDraft(text); // give back what was typed
    } finally {
      inFlight.current = false;
    }
  };

  return { draft, setDraft, add };
}
