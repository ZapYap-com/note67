import { useEffect, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItem } from "../types";
import { useTaskMutations } from "./tasks/useTaskMutations";
import { TaskDetailPane } from "./tasks/TaskDetailPane";
import { TaskCheckbox } from "./tasks/TaskCheckbox";
import { DueChip } from "./tasks/DueChip";

interface ActionsTabProps {
  noteId: string;
  canUseAI: boolean;
  onChanged?: () => void;
  /** When opened from the global Tasks view, the task to auto-select. */
  focusTaskId?: number | null;
}

export function ActionsTab({ noteId, canUseAI, onChanged, focusTaskId }: ActionsTabProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState("");
  // Seed from focusTaskId so opening from the central page lands on that task.
  const [selectedId, setSelectedId] = useState<number | null>(focusTaskId ?? null);
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const loading = noteId !== loadedNoteId;
  const m = useTaskMutations(items, setItems, onChanged);

  // Re-focus when focusTaskId changes within the same mount.
  const [prevFocus, setPrevFocus] = useState(focusTaskId);
  if (focusTaskId !== prevFocus) {
    setPrevFocus(focusTaskId);
    if (focusTaskId != null) setSelectedId(focusTaskId);
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, id });
  };

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
  }, [noteId]);

  const topLevel = items.filter((i) => i.parent_id == null);
  const selected =
    items.find((i) => i.id === selectedId && i.parent_id == null) ?? topLevel[0] ?? null;
  const subtasks = selected ? items.filter((i) => i.parent_id === selected.id) : [];

  const addTask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      // Autofill today's date on manual task entry (local YYYY-MM-DD).
      const today = new Date().toLocaleDateString("en-CA");
      const created = await tasksApi.createActionItem(noteId, trimmed, today);
      setItems((prev) => [...prev, created]);
      setDraft("");
      setSelectedId(created.id);
      onChanged?.();
    } catch (e) {
      console.error("Failed to create task:", e);
    }
  };

  const generate = async () => {
    if (extracting) return;
    setExtracting(true);
    try {
      await tasksApi.extractActionItems(noteId);
      const data = await tasksApi.getActionItems(noteId);
      setItems(data);
      onChanged?.();
    } catch (e) {
      console.error("Find tasks failed:", e);
    } finally {
      setExtracting(false);
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
          {canUseAI && (
            <button
              onClick={generate}
              disabled={extracting}
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
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-1">
          {topLevel.map((item) => {
            const subs = items.filter((i) => i.parent_id === item.id);
            const isSel = selected?.id === item.id;
            return (
              <div
                key={item.id}
                data-task-context
                onClick={() => setSelectedId(item.id)}
                onContextMenu={(e) => openMenu(e, item.id)}
                className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer"
                style={{ backgroundColor: isSel ? "var(--color-sidebar-selected)" : "transparent" }}
              >
                <TaskCheckbox done={item.done} onToggle={() => m.toggleDone(item)} className="mt-0.5" />
                <span className="flex-1 min-w-0">
                  <span
                    className="text-sm block"
                    style={{
                      color: item.done ? "var(--color-text-tertiary)" : "var(--color-text)",
                      textDecoration: item.done ? "line-through" : "none",
                    }}
                  >
                    {item.text}
                  </span>
                  <span className="flex items-center gap-2 mt-0.5">
                    {item.due_date && <DueChip date={item.due_date} />}
                    {subs.length > 0 && (
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        ☑ {subs.filter((s) => s.done).length}/{subs.length}
                      </span>
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Pinned add-task row */}
        <div
          className="shrink-0 border-t px-3 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2.5 px-2">
            <span
              className="w-4 h-4 rounded-[5px] shrink-0"
              style={{ border: "2px dashed var(--color-border)" }}
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask(draft)}
              onBlur={() => addTask(draft)}
              placeholder="Add a task…"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--color-text)" }}
            />
          </div>
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

      {menu && (
        <div
          className="fixed z-[100] min-w-[140px] py-1 rounded-lg"
          style={{
            left: menu.x,
            top: menu.y,
            backgroundColor: "var(--color-bg-elevated)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
          }}
        >
          <button
            onClick={() => {
              m.remove(menu.id);
              setMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2.5 text-sm transition-colors hover:bg-black/5"
            style={{ color: "#ef4444" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
