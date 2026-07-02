import { useEffect, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItem } from "../types";

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
  const [subDraft, setSubDraft] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const loading = noteId !== loadedNoteId;

  // Focus a specific task when navigated from the global Tasks view. Adjust
  // during render (guarded) so it wins over the default first-task selection.
  const [prevFocus, setPrevFocus] = useState(focusTaskId);
  if (focusTaskId !== prevFocus) {
    setPrevFocus(focusTaskId);
    if (focusTaskId != null) setSelectedId(focusTaskId);
  }

  // Close the right-click menu on any click or Escape.
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
  // Selection falls back to the first task so the detail pane is never empty.
  const selected =
    items.find((i) => i.id === selectedId && i.parent_id == null) ?? topLevel[0] ?? null;
  const subtasks = selected ? items.filter((i) => i.parent_id === selected.id) : [];

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
    // Remove the item and any of its subtasks locally.
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_id !== id));
    try {
      await tasksApi.deleteActionItem(id);
      onChanged?.();
    } catch (e) {
      console.error("Failed to delete task:", e);
    }
  };

  const addTask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const created = await tasksApi.createActionItem(noteId, trimmed);
      setItems((prev) => [...prev, created]);
      setDraft("");
      setSelectedId(created.id);
      onChanged?.();
    } catch (e) {
      console.error("Failed to create task:", e);
    }
  };

  const addSubtask = async (parentId: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const created = await tasksApi.createActionItem(noteId, trimmed, null, parentId);
      setItems((prev) => [...prev, created]);
      setSubDraft("");
      onChanged?.();
    } catch (e) {
      console.error("Failed to create subtask:", e);
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
    <div className="flex h-full -mx-6 -my-4" style={{ minHeight: "60vh" }}>
      {/* Left: task list */}
      <div
        className="w-1/2 flex flex-col border-r overflow-y-auto"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
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

        <div className="px-3 pb-3">
          {topLevel.map((item) => {
            const subs = items.filter((i) => i.parent_id === item.id);
            const isSel = selected?.id === item.id;
            return (
              <button
                key={item.id}
                data-task-context
                onClick={() => setSelectedId(item.id)}
                onContextMenu={(e) => openMenu(e, item.id)}
                className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors"
                style={{ backgroundColor: isSel ? "var(--color-sidebar-selected)" : "transparent" }}
              >
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDone(item);
                  }}
                  className="w-4 h-4 mt-0.5 rounded-[5px] shrink-0 flex items-center justify-center"
                  style={{
                    backgroundColor: item.done ? "var(--color-accent)" : "var(--color-bg-elevated)",
                    border: item.done ? "none" : "1.5px solid var(--color-accent)",
                  }}
                >
                  {item.done && <span className="text-white text-[10px] leading-none">✓</span>}
                </span>
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
                    {item.due_date && (
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        📅 {item.due_date}
                      </span>
                    )}
                    {subs.length > 0 && (
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        ☑ {subs.filter((s) => s.done).length}/{subs.length}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}

          {/* Add task */}
          <div className="flex items-center gap-2.5 p-2">
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
          <div className="px-6 py-4">
            {/* Title */}
            <div className="flex items-start gap-3">
              <span
                onClick={() => toggleDone(selected)}
                className="w-5 h-5 mt-0.5 rounded-md shrink-0 flex items-center justify-center cursor-pointer"
                style={{
                  backgroundColor: selected.done ? "var(--color-accent)" : "var(--color-bg-elevated)",
                  border: selected.done ? "none" : "1.5px solid var(--color-accent)",
                }}
              >
                {selected.done && <span className="text-white text-xs leading-none">✓</span>}
              </span>
              <input
                value={selected.text}
                onChange={(e) => patchLocal(selected.id, { text: e.target.value })}
                onBlur={() => persistById(selected.id)}
                className="flex-1 min-w-0 bg-transparent outline-none text-base font-medium"
                style={{
                  color: "var(--color-text)",
                  textDecoration: selected.done ? "line-through" : "none",
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
                value={selected.due_date ?? ""}
                onChange={(e) => patchLocal(selected.id, { due_date: e.target.value || null })}
                onBlur={() => persistById(selected.id)}
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
                value={selected.description ?? ""}
                onChange={(e) => patchLocal(selected.id, { description: e.target.value || null })}
                onBlur={() => persistById(selected.id)}
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
                    onContextMenu={(e) => openMenu(e, sub.id)}
                    className="flex items-center gap-2.5 p-1.5 rounded-lg group"
                  >
                    <span
                      onClick={() => toggleDone(sub)}
                      className="w-4 h-4 rounded-[5px] shrink-0 flex items-center justify-center cursor-pointer"
                      style={{
                        backgroundColor: sub.done ? "var(--color-accent)" : "var(--color-bg-elevated)",
                        border: sub.done ? "none" : "1.5px solid var(--color-accent)",
                      }}
                    >
                      {sub.done && <span className="text-white text-[10px] leading-none">✓</span>}
                    </span>
                    <input
                      value={sub.text}
                      onChange={(e) => patchLocal(sub.id, { text: e.target.value })}
                      onBlur={() => persistById(sub.id)}
                      className="flex-1 min-w-0 bg-transparent outline-none text-sm"
                      style={{
                        color: sub.done ? "var(--color-text-tertiary)" : "var(--color-text)",
                        textDecoration: sub.done ? "line-through" : "none",
                      }}
                    />
                    <button
                      onClick={() => remove(sub.id)}
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
                    onKeyDown={(e) => e.key === "Enter" && addSubtask(selected.id, subDraft)}
                    onBlur={() => addSubtask(selected.id, subDraft)}
                    placeholder="Add a subtask…"
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "var(--color-text)" }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right-click delete menu */}
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
              remove(menu.id);
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
