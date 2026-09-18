import { useCallback, useEffect, useMemo, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItem } from "../types";
import { useTasksUiStore } from "../stores/tasksUiStore";
import { useTaskMutations } from "./tasks/useTaskMutations";
import { TaskDetailPane } from "./tasks/TaskDetailPane";
import { useAddTask } from "./tasks/useAddTask";
import { AddTaskRow, TaskRow, UndoDeleteToast } from "./tasks/TaskListParts";
import { useTaskMenu } from "./tasks/useTaskMenu";

interface TasksViewProps {
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

export function TasksView({ onOpenInNote, noteTitles }: TasksViewProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const refreshKey = useTasksUiStore((s) => s.refreshKey);
  // Completed tasks load lazily (a long history isn't pulled with open tasks).
  const [completedLoaded, setCompletedLoaded] = useState(false);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [hasMoreCompleted, setHasMoreCompleted] = useState(false);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  const m = useTaskMutations(items, setItems);

  const COMPLETED_PAGE = 50;
  const loadCompletedPage = async () => {
    if (loadingCompleted) return;
    setLoadingCompleted(true);
    try {
      const page = await tasksApi.getCompletedActionItems(COMPLETED_PAGE, completedOffset);
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...page.filter((i) => !ids.has(i.id))];
      });
      setCompletedOffset((o) => o + COMPLETED_PAGE);
      setHasMoreCompleted(page.filter((i) => i.parent_id == null).length >= COMPLETED_PAGE);
      setCompletedLoaded(true);
    } catch (e) {
      console.error("Failed to load completed tasks:", e);
    } finally {
      setLoadingCompleted(false);
    }
  };

  const toggleShowCompleted = () => {
    const next = !showCompleted;
    setShowCompleted(next);
    if (next && !completedLoaded) loadCompletedPage();
  };

  // Add a standalone task (not tied to any note).
  const {
    draft,
    setDraft,
    add: addStandaloneTask,
  } = useAddTask(null, (created) => {
    setItems((prev) => [...prev, created]);
    setSelectedId(created.id);
  });

  useEffect(() => {
    let cancelled = false;
    tasksApi
      .getOpenActionItems()
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

  const deselect = useCallback(() => setSelectedId(null), []);
  const { openMenu, menuElement } = useTaskMenu({
    selectedId,
    onDeselect: deselect,
    onDelete: m.remove,
  });

  const topLevel = items.filter(
    (i) =>
      i.parent_id == null &&
      (showCompleted || !i.done) &&
      bucketMatches(bucketFor(i.due_date), dateFilter)
  );
  const selected =
    items.find((i) => i.id === selectedId && i.parent_id == null) ?? null;
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
              onClick={toggleShowCompleted}
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
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    subtasks={items.filter((i) => i.parent_id === task.id)}
                    selected={selected?.id === task.id}
                    onSelect={() => setSelectedId(task.id)}
                    onToggle={() => m.toggleDone(task)}
                    onContextMenu={(e) => openMenu(e, task.id)}
                    meta={
                      <span className="text-xs truncate" style={{ color: "var(--color-text-tertiary)" }}>
                        {task.note_id ? noteTitles[task.note_id] ?? "Note" : "No note"}
                      </span>
                    }
                    actions={
                      task.note_id && (
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
                      )
                    }
                  />
                ))}
              </div>
            ))
          )}

          {showCompleted && hasMoreCompleted && (
            <button
              onClick={loadCompletedPage}
              disabled={loadingCompleted}
              className="w-full mt-1 mb-2 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50"
              style={{ color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-subtle)" }}
            >
              {loadingCompleted ? "Loading…" : "Load more completed"}
            </button>
          )}
        </div>

        {/* Pinned add-task row (standalone task, no note) */}
        {loaded && (
          <div
            className="shrink-0 border-t px-4 py-2"
            style={{ borderColor: "var(--color-border)" }}
          >
            <AddTaskRow draft={draft} setDraft={setDraft} onAdd={addStandaloneTask} />
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

      {menuElement}
      <UndoDeleteToast deleted={m.deleted} onUndo={m.undoDelete} onDismiss={m.dismissDeleted} />
    </div>
  );
}
