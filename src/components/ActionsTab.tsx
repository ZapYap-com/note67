import { useCallback, useEffect, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItem } from "../types";
import { useTasksUiStore } from "../stores/tasksUiStore";
import { useTaskMutations } from "./tasks/useTaskMutations";
import { TaskDetailPane } from "./tasks/TaskDetailPane";
import { useAddTask } from "./tasks/useAddTask";
import { AddTaskRow, TaskRow, UndoDeleteToast } from "./tasks/TaskListParts";
import { useTaskMenu } from "./tasks/useTaskMenu";

interface ActionsTabProps {
  noteId: string;
  canUseAI: boolean;
  /** When opened from the global Tasks view, the task to auto-select. */
  focusTaskId?: number | null;
}

export function ActionsTab({ noteId, canUseAI, focusTaskId }: ActionsTabProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  // Seed from focusTaskId so opening from the central page lands on that task.
  const [selectedId, setSelectedId] = useState<number | null>(focusTaskId ?? null);
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const loading = noteId !== loadedNoteId;
  const m = useTaskMutations(items, setItems);

  const refreshKey = useTasksUiStore((s) => s.refreshKey);
  const bumpRefreshKey = useTasksUiStore((s) => s.bumpRefreshKey);
  const extracting = useTasksUiStore((s) => s.extractingNoteIds.includes(noteId));
  const setExtracting = useTasksUiStore((s) => s.setExtracting);

  // Re-focus when focusTaskId changes within the same mount.
  const [prevFocus, setPrevFocus] = useState(focusTaskId);
  if (focusTaskId !== prevFocus) {
    setPrevFocus(focusTaskId);
    if (focusTaskId != null) setSelectedId(focusTaskId);
  }

  const deselect = useCallback(() => setSelectedId(null), []);
  const { openMenu, menuElement } = useTaskMenu({
    selectedId,
    onDeselect: deselect,
    onDelete: m.remove,
  });

  useEffect(() => {
    let cancelled = false;
    tasksApi
      .getActionItems(noteId)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setLoadedNoteId(noteId);
      })
      .catch((e) => console.error("Failed to load tasks:", e));
    return () => {
      cancelled = true;
    };
  }, [noteId, refreshKey]);

  const topLevel = items.filter((i) => i.parent_id == null);
  const selected =
    items.find((i) => i.id === selectedId && i.parent_id == null) ?? null;
  const subtasks = selected ? items.filter((i) => i.parent_id === selected.id) : [];

  const { draft, setDraft, add: addTask } = useAddTask(noteId, (created) => {
    setItems((prev) => [...prev, created]);
    setSelectedId(created.id);
  });

  const generate = async () => {
    if (extracting) return;
    setExtracting(noteId, true);
    try {
      await tasksApi.extractActionItems(noteId);
      bumpRefreshKey(); // reloads this list, and any other one showing these tasks
    } catch (e) {
      console.error("Find tasks failed:", e);
    } finally {
      setExtracting(noteId, false);
    }
  };

  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="flex h-full -mx-6">
      {/* Left: task list */}
      <div
        className="w-1/2 flex flex-col border-r overflow-hidden"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Tasks
            {topLevel.length > 0 && (
              <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-tertiary)" }}>
                {topLevel.filter((i) => !i.done).length} open
              </span>
            )}
          </h2>
          {/* Shown even without AI, so the feature can be found and the
              tooltip says what it needs. */}
          <button
            onClick={generate}
            disabled={extracting || !canUseAI}
            title={canUseAI ? undefined : "Start Ollama to find tasks"}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--color-bg-subtle)", color: "var(--color-text)" }}
          >
            {extracting ? (
              <span
                className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: "var(--color-text-secondary)", borderTopColor: "transparent" }}
              />
            ) : (
              <span>✦</span>
            )}
            {extracting ? "Finding…" : "Generate"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-1">
          {topLevel.map((item) => (
            <TaskRow
              key={item.id}
              task={item}
              subtasks={items.filter((i) => i.parent_id === item.id)}
              selected={selected?.id === item.id}
              onSelect={() => setSelectedId(item.id)}
              onToggle={() => m.toggleDone(item)}
              onContextMenu={(e) => openMenu(e, item.id)}
            />
          ))}
        </div>

        {/* Pinned add-task row */}
        <div
          className="shrink-0 border-t px-3 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <AddTaskRow draft={draft} setDraft={setDraft} onAdd={addTask} />
        </div>
      </div>

      {/* Right: task detail */}
      <div className="w-1/2 overflow-y-auto">
        {!selected ? (
          <div
            className="h-full flex items-center justify-center text-sm"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Select a task to see its details.
          </div>
        ) : (
          <TaskDetailPane
            key={selected.id}
            item={selected}
            subtasks={subtasks}
            m={m}
            onSubtaskContextMenu={openMenu}
          />
        )}
      </div>

      {menuElement}
      <UndoDeleteToast deleted={m.deleted} onUndo={m.undoDelete} onDismiss={m.dismissDeleted} />
    </div>
  );
}
