import { useState, useEffect } from "react";
import type { Meeting, UpdateMeeting } from "../types";

interface MeetingEditorProps {
  meeting: Meeting;
  onSave: (update: UpdateMeeting) => Promise<void>;
  onClose: () => void;
}

export function MeetingEditor({ meeting, onSave, onClose }: MeetingEditorProps) {
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description || "");
  const [participants, setParticipants] = useState(meeting.participants || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(meeting.title);
    setDescription(meeting.description || "");
    setParticipants(meeting.participants || "");
  }, [meeting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        participants: participants.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            Edit Meeting
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div
              className="px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", color: "#dc2626" }}
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium mb-1.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg outline-none transition-colors"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
              }}
              placeholder="Meeting title..."
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium mb-1.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 text-sm rounded-lg outline-none transition-colors resize-none"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
              }}
              placeholder="Meeting notes or description..."
            />
          </div>

          <div>
            <label
              htmlFor="participants"
              className="block text-sm font-medium mb-1.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Participants
            </label>
            <input
              id="participants"
              type="text"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg outline-none transition-colors"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
              }}
              placeholder="John, Jane, Alex..."
            />
            <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              Separate names with commas
            </p>
          </div>

          {/* Actions */}
          <div
            className="flex justify-end gap-2 pt-4"
            style={{ borderTop: "1px solid var(--color-border-subtle)" }}
          >
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-text)",
                color: "white",
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
