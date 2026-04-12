import { useState, useEffect } from "react";
import { useLinksStore } from "../stores/linksStore";

interface BacklinksPanelProps {
  noteId: string;
  onNavigate: (noteId: string) => void;
}

export function BacklinksPanel({ noteId, onNavigate }: BacklinksPanelProps) {
  const { backlinks, loading, fetchBacklinks } = useLinksStore();
  const [isExpanded, setIsExpanded] = useState(true);

  // Fetch backlinks when note changes
  useEffect(() => {
    fetchBacklinks(noteId);
  }, [noteId, fetchBacklinks]);

  // Don't render if no backlinks and not loading
  if (!loading && backlinks.length === 0) {
    return null;
  }

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // Get context snippet from description
  const getContextSnippet = (description: string | null, maxLength = 80) => {
    if (!description) return null;
    // Look for [[note title]] pattern and show surrounding text
    const match = description.match(/\[\[([^\]]+)\]\]/);
    if (match) {
      const linkIndex = description.indexOf(match[0]);
      const start = Math.max(0, linkIndex - 30);
      const end = Math.min(description.length, linkIndex + match[0].length + 30);
      let snippet = description.slice(start, end);
      if (start > 0) snippet = "..." + snippet;
      if (end < description.length) snippet = snippet + "...";
      return snippet;
    }
    // Fallback to start of description
    if (description.length <= maxLength) return description;
    return description.slice(0, maxLength).trim() + "...";
  };

  return (
    <div
      className="border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 transition-transform"
            style={{
              color: "var(--color-text-secondary)",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text)" }}
          >
            Linked References
          </span>
          {!loading && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text-tertiary)",
              }}
            >
              {backlinks.length}
            </span>
          )}
        </div>
        {loading && (
          <div
            className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
            style={{
              borderColor: "var(--color-text-tertiary)",
              borderTopColor: "transparent",
            }}
          />
        )}
      </button>

      {/* Backlinks list */}
      {isExpanded && !loading && backlinks.length > 0 && (
        <div className="px-4 pb-3">
          {backlinks.map((note) => (
            <button
              key={note.id}
              onClick={() => onNavigate(note.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-black/5 transition-colors mb-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--color-text)" }}
                >
                  {note.title}
                </span>
                <span
                  className="text-xs shrink-0"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {formatDate(note.started_at)}
                </span>
              </div>
              {note.description && (
                <div
                  className="text-xs mt-0.5 line-clamp-2"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {getContextSnippet(note.description)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
