import { useMemo } from "react";
import { useOpenTasks } from "../hooks";
import type { ActionItemWithNote } from "../types";

interface TasksViewProps {
  onSelectNote: (noteId: string) => void;
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

export function TasksView({ onSelectNote, refreshKey = 0 }: TasksViewProps) {
  const { tasks, loading } = useOpenTasks(refreshKey);

  const groups = useMemo(() => {
    const map = new Map<Bucket, ActionItemWithNote[]>();
    for (const task of tasks) {
      const b = bucketFor(task.due_date);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(task);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({
      label: b,
      tasks: map.get(b)!,
    }));
  }, [tasks]);

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
        ) : tasks.length === 0 ? (
          <div
            className="rounded-xl px-6 py-12 text-center"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              No open action items yet.
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-text-tertiary)" }}>
              Add <code>- [ ] a task</code> to a note, or use “Find action items”
              after a meeting.
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
                    <button
                      key={task.id}
                      onClick={() => onSelectNote(task.note_id)}
                      className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors hover:bg-black/5"
                      style={{ backgroundColor: "var(--color-bg-subtle)" }}
                    >
                      <span
                        className="w-4 h-4 mt-0.5 rounded-[5px] shrink-0"
                        style={{ border: "2px solid var(--color-border)" }}
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
                    </button>
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
