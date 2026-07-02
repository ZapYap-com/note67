import { useEffect, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItem } from "../types";

interface ActionsTabProps {
  noteId: string;
  canUseAI: boolean;
  onChanged?: () => void;
}

export function ActionsTab({ noteId, canUseAI, onChanged }: ActionsTabProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState("");
  // Derive loading from which note's items are loaded, so the effect doesn't
  // set a loading flag synchronously.
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const loading = noteId !== loadedNoteId;

  // Load on note change. Inlined so setState only runs post-await.
  useEffect(() => {
    let cancelled = false;
    tasksApi
      .getActionItems(noteId)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setLoadedNoteId(noteId);
      })
      .catch((e) => console.error("Failed to load action items:", e));
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const patchLocal = (id: number, patch: Partial<ActionItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const persist = async (item: ActionItem) => {
    try {
      await tasksApi.updateActionItem(
        item.id,
        item.text,
        item.assignee,
        item.due_date,
        item.done
      );
      onChanged?.();
    } catch (e) {
      console.error("Failed to update action item:", e);
    }
  };

  const toggleDone = async (item: ActionItem) => {
    const next = { ...item, done: !item.done };
    patchLocal(item.id, { done: next.done });
    await persist(next);
  };

  const remove = async (id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await tasksApi.deleteActionItem(id);
      onChanged?.();
    } catch (e) {
      console.error("Failed to delete action item:", e);
    }
  };

  const addItem = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const created = await tasksApi.createActionItem(noteId, trimmed, null, null);
      setItems((prev) => [...prev, created]);
      setDraft("");
      onChanged?.();
    } catch (e) {
      console.error("Failed to create action item:", e);
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
      console.error("Find action items failed:", e);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Action items
          {items.length > 0 && (
            <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-tertiary)" }}>
              {items.filter((i) => !i.done).length} open
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => setEditMode((v) => !v)}
            className="px-2.5 py-1 text-xs font-medium rounded-full transition-colors"
            style={{
              backgroundColor: editMode ? "var(--color-accent)" : "var(--color-bg-subtle)",
              color: editMode ? "white" : "var(--color-text)",
            }}
          >
            {editMode ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
          Loading…
        </p>
      ) : items.length === 0 && !editMode ? (
        <div
          className="rounded-xl px-6 py-10 text-center"
          style={{ backgroundColor: "var(--color-bg-subtle)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            No action items yet.
          </p>
          <p className="text-xs mt-1.5" style={{ color: "var(--color-text-tertiary)" }}>
            {canUseAI ? "Generate them from the meeting, or " : ""}
            <button onClick={() => setEditMode(true)} className="underline" style={{ color: "var(--color-accent)" }}>
              add one
            </button>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) =>
            editMode ? (
              <EditRow
                key={item.id}
                item={item}
                onToggle={() => toggleDone(item)}
                onPatchLocal={(patch) => patchLocal(item.id, patch)}
                onPersist={() => persist(items.find((i) => i.id === item.id) ?? item)}
                onDelete={() => remove(item.id)}
              />
            ) : (
              <ViewRow key={item.id} item={item} onToggle={() => toggleDone(item)} />
            )
          )}

          {editMode && (
            <div className="flex items-center gap-2.5 p-2 pt-3">
              <span
                className="w-4 h-4 rounded-[5px] shrink-0"
                style={{ border: "2px dashed var(--color-border)" }}
              />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addItem(draft);
                }}
                onBlur={() => addItem(draft)}
                placeholder="Add an action item…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "var(--color-text)" }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewRow({ item, onToggle }: { item: ActionItem; onToggle: () => void }) {
  return (
    <div className="flex items-start gap-3 p-2 rounded-lg">
      <button
        onClick={onToggle}
        className="w-4 h-4 mt-0.5 rounded-[5px] shrink-0 flex items-center justify-center transition-colors"
        style={{
          backgroundColor: item.done ? "var(--color-accent)" : "transparent",
          border: item.done ? "none" : "2px solid var(--color-border)",
        }}
      >
        {item.done && <span className="text-white text-[10px] leading-none">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <span
          className="text-sm"
          style={{
            color: item.done ? "var(--color-text-tertiary)" : "var(--color-text)",
            textDecoration: item.done ? "line-through" : "none",
          }}
        >
          {item.text}
        </span>
        {(item.assignee || item.due_date) && (
          <div className="flex items-center gap-2 mt-1">
            {item.assignee && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ backgroundColor: "var(--color-accent-light)", color: "var(--color-accent)" }}
              >
                @{item.assignee}
              </span>
            )}
            {item.due_date && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ backgroundColor: "var(--color-bg-subtle)", color: "var(--color-text-secondary)" }}
              >
                📅 {item.due_date}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EditRow({
  item,
  onToggle,
  onPatchLocal,
  onPersist,
  onDelete,
}: {
  item: ActionItem;
  onToggle: () => void;
  onPatchLocal: (patch: Partial<ActionItem>) => void;
  onPersist: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2.5 p-2 rounded-lg"
      style={{ backgroundColor: "var(--color-bg-subtle)" }}
    >
      <button
        onClick={onToggle}
        className="w-4 h-4 rounded-[5px] shrink-0 flex items-center justify-center"
        style={{
          backgroundColor: item.done ? "var(--color-accent)" : "transparent",
          border: item.done ? "none" : "2px solid var(--color-border)",
        }}
      >
        {item.done && <span className="text-white text-[10px] leading-none">✓</span>}
      </button>
      <input
        value={item.text}
        onChange={(e) => onPatchLocal({ text: e.target.value })}
        onBlur={onPersist}
        className="flex-1 min-w-0 bg-transparent outline-none text-sm"
        style={{ color: "var(--color-text)" }}
      />
      <input
        value={item.assignee ?? ""}
        onChange={(e) => onPatchLocal({ assignee: e.target.value || null })}
        onBlur={onPersist}
        placeholder="@who"
        className="w-20 bg-transparent outline-none text-xs text-right"
        style={{ color: "var(--color-text-secondary)" }}
      />
      <input
        type="date"
        value={item.due_date ?? ""}
        onChange={(e) => onPatchLocal({ due_date: e.target.value || null })}
        onBlur={onPersist}
        className="bg-transparent outline-none text-xs"
        style={{ color: "var(--color-text-secondary)" }}
      />
      <button
        onClick={onDelete}
        className="p-1 rounded shrink-0 hover:bg-black/5"
        style={{ color: "var(--color-text-tertiary)" }}
        title="Delete"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
