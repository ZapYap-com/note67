import { useMemo, useState } from "react";
import { useOpenTasks } from "../hooks";
import { tasksApi } from "../api";
import type { ActionItemWithNote } from "../types";

interface TasksViewProps {
  onSelectTask: (noteId: string, taskId: number) => void;
  refreshKey?: number;
}

type Bucket = "Overdue" | "Today" | "Upcoming" | "No due date";
const BUCKET_ORDER: Bucket[] = ["Overdue", "Today", "Upcoming", "No due date"];

function bucketFor(dueDate: string | null): Bucket {
  if (!dueDate) return "No due date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  if (due < today) return "Overdue";
  if (due.getTime() === today.getTime()) return "Today";
  return "Upcoming";
}

function formatDue(dueDate: string) {
  return new Date(dueDate + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function TasksView({ onSelectTask, refreshKey = 0 }: TasksViewProps) {
  const { tasks, loading } = useOpenTasks(refreshKey);
  // Checking a task off hides it immediately (it drops out of the open list).
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const visibleTasks = tasks.filter((t) => !completed.has(t.id));

  const completeTask = async (id: number) => {
    setCompleted((prev) => new Set(prev).add(id));
    try {
      await tasksApi.setActionItemDone(id, true);
    } catch (e) {
      console.error("Failed to complete task:", e);
      setCompleted((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const groups = useMemo(() => {
    const map = new Map<Bucket, ActionItemWithNote[]>();
    for (const task of visibleTasks) {
      const b = bucketFor(task.due_date);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(task);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({
      label: b,
      tasks: map.get(b)!,
    }));
  }, [visibleTasks]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Tasks
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
            Open action items from every meeting, in one place.
          </p>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
            Loading…
          </p>
        ) : visibleTasks.length === 0 ? (
          <div
            className="rounded-xl px-6 py-12 text-center"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              No open tasks. Nice.
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-text-tertiary)" }}>
              Add tasks in a note's Tasks tab, or Generate them after a meeting.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                <div
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{
                    color:
                      group.label === "Overdue"
                        ? "var(--color-accent)"
                        : "var(--color-text-tertiary)",
                  }}
                >
                  {group.label}
                  <span className="ml-1.5 font-normal">({group.tasks.length})</span>
                </div>
                <div className="space-y-1">
                  {group.tasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => onSelectTask(task.note_id, task.id)}
                      className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors hover:bg-black/5 cursor-pointer"
                      style={{ backgroundColor: "var(--color-bg-subtle)" }}
                    >
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          completeTask(task.id);
                        }}
                        className="w-4 h-4 mt-0.5 rounded-[5px] shrink-0 cursor-pointer"
                        style={{
                          backgroundColor: "var(--color-bg-elevated)",
                          border: "1.5px solid var(--color-accent)",
                        }}
                        title="Mark done"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: "var(--color-text)" }}>
                          {task.text}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className="text-xs truncate"
                            style={{ color: "var(--color-text-tertiary)" }}
                          >
                            {task.note_title}
                          </span>
                          {task.due_date && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor:
                                  bucketFor(task.due_date) === "Overdue"
                                    ? "rgba(239,68,68,0.12)"
                                    : "var(--color-bg-elevated)",
                                color:
                                  bucketFor(task.due_date) === "Overdue"
                                    ? "#dc2626"
                                    : "var(--color-text-secondary)",
                              }}
                            >
                              📅 {formatDue(task.due_date)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
