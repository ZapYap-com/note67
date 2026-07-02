import { useEffect, useMemo, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItem } from "../types";
import { useTaskMutations } from "./tasks/useTaskMutations";
import { TaskDetailPane } from "./tasks/TaskDetailPane";
import { TaskCheckbox } from "./tasks/TaskCheckbox";
import { DueChip } from "./tasks/DueChip";

interface TasksViewProps {
  refreshKey?: number;
  onOpenInNote: (noteId: string, taskId: number) => void;
  noteTitles: Record<string, string>;
}

type Bucket = "Past" | "Today" | "Tomorrow" | "Future" | "No date";
const BUCKET_ORDER: Bucket[] = ["Past", "Today", "Tomorrow", "Future", "No date"];

function bucketFor(due: string | null): Bucket {
  if (!due) return "No date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "Past";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return "Future";
}

type DateFilter = "all" | "past" | "today" | "upcoming" | "none";
const FILTERS: { key: DateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "past", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "none", label: "No date" },
];
function bucketMatches(b: Bucket, f: DateFilter): boolean {
  if (f === "all") return true;
  if (f === "past") return b === "Past";
  if (f === "today") return b === "Today";
  if (f === "upcoming") return b === "Tomorrow" || b === "Future";
  return b === "No date";
}

export function TasksView({ refreshKey = 0, onOpenInNote, noteTitles }: TasksViewProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const m = useTaskMutations(items, setItems);

  // Add a standalone task (not tied to any note) with today's date.
  const addStandaloneTask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const today = new Date().toLocaleDateString("en-CA");
      const created = await tasksApi.createActionItem(null, trimmed, today);
      setItems((prev) => [...prev, created]);
      setDraft("");
      setSelectedId(created.id);
    } catch (e) {
      console.error("Failed to create task:", e);
    }
  };

  useEffect(() => {
    let cancelled = false;
    tasksApi
      .getAllActionItems()
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setLoaded(true);
      })
      .catch((e) => console.error("Failed to load tasks:", e));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

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

  const topLevel = items.filter(
    (i) =>
      i.parent_id == null &&
      (showCompleted || !i.done) &&
      bucketMatches(bucketFor(i.due_date), dateFilter)
  );
  const selected =
    items.find((i) => i.id === selectedId && i.parent_id == null) ?? topLevel[0] ?? null;
  const subtasks = selected ? items.filter((i) => i.parent_id === selected.id) : [];

  const groups = useMemo(() => {
    const map = new Map<Bucket, ActionItem[]>();
    for (const t of topLevel) {
      const b = bucketFor(t.due_date);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(t);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({
      label: b,
      tasks: map.get(b)!.sort((a, c) => (a.due_date ?? "9999").localeCompare(c.due_date ?? "9999")),
    }));
  }, [topLevel]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: grouped task list */}
      <div
        className="w-1/2 flex flex-col border-r overflow-hidden"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <h1 className="text-xl font-semibold" style={{ color: "var(--color-text)" }}>
              Tasks
            </h1>
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="text-xs px-2.5 py-1 rounded-full transition-colors"
              style={{
                backgroundColor: showCompleted ? "var(--color-accent)" : "var(--color-bg-subtle)",
                color: showCompleted ? "white" : "var(--color-text-secondary)",
              }}
            >
              {showCompleted ? "Hide completed" : "Show completed"}
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setDateFilter(f.key)}
                className="text-xs px-2 py-0.5 rounded-full transition-colors"
                style={{
                  backgroundColor:
                    dateFilter === f.key ? "var(--color-accent-light)" : "transparent",
                  color:
                    dateFilter === f.key ? "var(--color-accent)" : "var(--color-text-tertiary)",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-1">
          {!loaded ? (
            <p className="text-sm px-2" style={{ color: "var(--color-text-tertiary)" }}>
              Loading…
            </p>
          ) : topLevel.length === 0 ? (
            <p className="text-sm px-2" style={{ color: "var(--color-text-tertiary)" }}>
              No open tasks. Nice.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-4">
                <div
                  className="px-2 mb-1 text-xs font-semibold uppercase tracking-wider"
                  style={{
                    color:
                      group.label === "Past" ? "var(--color-accent)" : "var(--color-text-tertiary)",
                  }}
                >
                  {group.label}
                  <span className="ml-1.5 font-normal">({group.tasks.length})</span>
                </div>
                {group.tasks.map((task) => {
                  const subs = items.filter((i) => i.parent_id === task.id);
                  const isSel = selected?.id === task.id;
                  return (
                    <div
                      key={task.id}
                      data-task-context
                      onClick={() => setSelectedId(task.id)}
                      onContextMenu={(e) => openMenu(e, task.id)}
                      className="w-full flex items-start gap-2.5 p-2 rounded-lg cursor-pointer group"
                      style={{ backgroundColor: isSel ? "var(--color-sidebar-selected)" : "transparent" }}
                    >
                      <TaskCheckbox done={task.done} onToggle={() => m.toggleDone(task)} className="mt-0.5" />
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
                          {task.due_date && (
                            <DueChip
                              date={task.due_date}
                              overdue={bucketFor(task.due_date) === "Past"}
                            />
                          )}
                          <span className="text-xs truncate" style={{ color: "var(--color-text-tertiary)" }}>
                            {task.note_id ? noteTitles[task.note_id] ?? "Note" : "No note"}
                          </span>
                          {subs.length > 0 && (
                            <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                              ☑ {subs.filter((s) => s.done).length}/{subs.length}
                            </span>
                          )}
                        </span>
                      </span>
                      {task.note_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInNote(task.note_id!, task.id);
                          }}
                          className="p-1 rounded shrink-0 opacity-0 group-hover:opacity-100 hover:bg-black/5"
                          style={{ color: "var(--color-text-tertiary)" }}
                          title="Open in note"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Pinned add-task row (standalone task, no note) */}
        {loaded && (
          <div
            className="shrink-0 border-t px-4 py-2"
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
                onKeyDown={(e) => e.key === "Enter" && addStandaloneTask(draft)}
                onBlur={() => addStandaloneTask(draft)}
                placeholder="Add a task…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "var(--color-text)" }}
              />
            </div>
          </div>
        )}
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
            header={
              selected.note_id ? (
                <button
                  onClick={() => onOpenInNote(selected.note_id!, selected.id)}
                  className="flex items-center gap-1.5 text-xs mb-3 transition-colors hover:underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  {noteTitles[selected.note_id] ?? "Open in note"}
                </button>
              ) : (
                <p className="text-xs mb-3" style={{ color: "var(--color-text-tertiary)" }}>
                  Standalone task
                </p>
              )
            }
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
