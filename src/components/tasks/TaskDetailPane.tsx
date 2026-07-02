import { useState } from "react";
import type { ActionItem } from "../../types";
import { TaskCheckbox } from "./TaskCheckbox";

export interface TaskMutations {
  patchLocal: (id: number, patch: Partial<ActionItem>) => void;
  persistById: (id: number) => void;
  toggleDone: (item: ActionItem) => void;
  remove: (id: number) => void;
  addSubtask: (noteId: string | null, parentId: number, text: string) => void;
}

interface TaskDetailPaneProps {
  item: ActionItem;
  subtasks: ActionItem[];
  m: TaskMutations;
  onSubtaskContextMenu?: (e: React.MouseEvent, id: number) => void;
  /** Optional header shown above the task (e.g. the source note on the central page). */
  header?: React.ReactNode;
}

/** The editable detail for a single task: title, due date, description, subtasks.
 * Shared by the per-note Tasks tab and the central Tasks page. Key it by
 * `item.id` at the call site so the subtask draft resets per task. */
export function TaskDetailPane({
  item,
  subtasks,
  m,
  onSubtaskContextMenu,
  header,
}: TaskDetailPaneProps) {
  const [subDraft, setSubDraft] = useState("");

  return (
    <div className="px-6 py-4">
      {header}

      {/* Title */}
      <div className="flex items-start gap-3">
        <TaskCheckbox done={item.done} onToggle={() => m.toggleDone(item)} size="md" className="mt-0.5" />
        <input
          value={item.text}
          onChange={(e) => m.patchLocal(item.id, { text: e.target.value })}
          onBlur={() => m.persistById(item.id)}
          className="flex-1 min-w-0 bg-transparent outline-none text-base font-medium"
          style={{
            color: "var(--color-text)",
            textDecoration: item.done ? "line-through" : "none",
          }}
        />
      </div>

      {/* Due date */}
      <div className="flex items-center gap-2 mt-4">
        <span className="text-xs font-medium w-16" style={{ color: "var(--color-text-secondary)" }}>
          Due
        </span>
        <input
          type="date"
          value={item.due_date ?? ""}
          onChange={(e) => m.patchLocal(item.id, { due_date: e.target.value || null })}
          onBlur={() => m.persistById(item.id)}
          className="bg-transparent outline-none text-sm"
          style={{ color: "var(--color-text)" }}
        />
      </div>

      {/* Description */}
      <div className="mt-4">
        <span className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-secondary)" }}>
          Description
        </span>
        <textarea
          value={item.description ?? ""}
          onChange={(e) => m.patchLocal(item.id, { description: e.target.value || null })}
          onBlur={() => m.persistById(item.id)}
          rows={4}
          placeholder="Add more detail…"
          className="w-full px-3 py-2 text-sm rounded-lg outline-none resize-none"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
        />
      </div>

      {/* Subtasks */}
      <div className="mt-5">
        <span className="text-xs font-medium block mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
          Subtasks
          {subtasks.length > 0 && (
            <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-tertiary)" }}>
              {subtasks.filter((s) => s.done).length}/{subtasks.length}
            </span>
          )}
        </span>
        <div className="space-y-0.5">
          {subtasks.map((sub) => (
            <div
              key={sub.id}
              data-task-context
              onContextMenu={(e) => onSubtaskContextMenu?.(e, sub.id)}
              className="flex items-center gap-2.5 p-1.5 rounded-lg group"
            >
              <TaskCheckbox done={sub.done} onToggle={() => m.toggleDone(sub)} />
              <input
                value={sub.text}
                onChange={(e) => m.patchLocal(sub.id, { text: e.target.value })}
                onBlur={() => m.persistById(sub.id)}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm"
                style={{
                  color: sub.done ? "var(--color-text-tertiary)" : "var(--color-text)",
                  textDecoration: sub.done ? "line-through" : "none",
                }}
              />
              <button
                onClick={() => m.remove(sub.id)}
                className="p-1 rounded shrink-0 opacity-0 group-hover:opacity-100 hover:bg-black/5"
                style={{ color: "var(--color-text-tertiary)" }}
                title="Delete subtask"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2.5 p-1.5">
            <span
              className="w-4 h-4 rounded-[5px] shrink-0"
              style={{ border: "2px dashed var(--color-border)" }}
            />
            <input
              value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  m.addSubtask(item.note_id, item.id, subDraft);
                  setSubDraft("");
                }
              }}
              onBlur={() => {
                m.addSubtask(item.note_id, item.id, subDraft);
                setSubDraft("");
              }}
              placeholder="Add a subtask…"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--color-text)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
