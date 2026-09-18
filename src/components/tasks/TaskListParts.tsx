import { useEffect, type ReactNode } from "react";
import type { ActionItem } from "../../types";
import type { DeletedTask } from "./useTaskMutations";
import { TaskCheckbox } from "./TaskCheckbox";
import { DueChip } from "./DueChip";

/**
 * The pieces a note's Tasks tab and the central Tasks page both use: a task
 * row, the "Add a task…" row and the Undo toast (the right-click menu is
 * useTaskMenu). Each list used to carry its own near-identical copy.
 */

interface TaskRowProps {
  task: ActionItem;
  subtasks: ActionItem[];
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Extra metadata after the due date (e.g. the source note's title). */
  meta?: ReactNode;
  /** Trailing controls (e.g. "Open in note"). */
  actions?: ReactNode;
}

export function TaskRow({
  task,
  subtasks,
  selected,
  onSelect,
  onToggle,
  onContextMenu,
  meta,
  actions,
}: TaskRowProps) {
  return (
    <div
      data-task-context
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer group"
      style={{ backgroundColor: selected ? "var(--color-sidebar-selected)" : "transparent" }}
    >
      <TaskCheckbox done={task.done} onToggle={onToggle} className="mt-0.5" />
      <span className="flex-1 min-w-0">
        <span
          className="text-sm block"
          style={{
            color: task.done ? "var(--color-text-tertiary)" : "var(--color-text)",
            textDecoration: task.done ? "line-through" : "none",
          }}
        >
          {task.text}
        </span>
        <span className="flex items-center gap-2 mt-0.5">
          {task.due_date && <DueChip date={task.due_date} done={task.done} />}
          {meta}
          {subtasks.length > 0 && (
            <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              ☑ {subtasks.filter((s) => s.done).length}/{subtasks.length}
            </span>
          )}
        </span>
      </span>
      {actions}
    </div>
  );
}

export function AddTaskRow({
  draft,
  setDraft,
  onAdd,
}: {
  draft: string;
  setDraft: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span
        className="w-4 h-4 rounded-[5px] shrink-0"
        style={{ border: "2px dashed var(--color-border)" }}
      />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
        onBlur={onAdd}
        placeholder="Add a task…"
        className="flex-1 bg-transparent outline-none text-sm"
        style={{ color: "var(--color-text)" }}
      />
    </div>
  );
}

/** "Task deleted · Undo", for five seconds after a delete. */
export function UndoDeleteToast({
  deleted,
  onUndo,
  onDismiss,
}: {
  deleted: DeletedTask | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!deleted) return;
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [deleted, onDismiss]);

  if (!deleted) return null;
  const subs = deleted.subtasks.length;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-2 rounded-lg text-sm shadow-lg"
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text)",
      }}
    >
      <span>
        Task deleted{subs > 0 ? ` with ${subs} subtask${subs === 1 ? "" : "s"}` : ""}
      </span>
      <button
        onClick={onUndo}
        className="font-medium"
        style={{ color: "var(--color-accent)" }}
      >
        Undo
      </button>
    </div>
  );
}
