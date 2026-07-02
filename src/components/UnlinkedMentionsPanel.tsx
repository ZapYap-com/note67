import { useState, useEffect } from "react";
import { linksApi } from "../api/links";
import type { UnlinkedMention } from "../types";

interface UnlinkedMentionsPanelProps {
  noteId: string;
  noteTitle: string;
  onNavigate: (noteId: string) => void;
  onLinkMention?: (sourceNoteId: string, targetTitle: string) => void;
}

export function UnlinkedMentionsPanel({
  noteId,
  noteTitle,
  onNavigate,
  onLinkMention,
}: UnlinkedMentionsPanelProps) {
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  // Derive loading from which note's mentions are loaded, so the fetch effect
  // doesn't need to set a loading flag synchronously.
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const loading = noteId !== loadedNoteId;

  // Fetch unlinked mentions when the note changes. Inlined so setState only
  // runs in the async continuation.
  useEffect(() => {
    let cancelled = false;
    linksApi
      .getUnlinkedMentions(noteId)
      .then((results) => {
        if (cancelled) return;
        setMentions(results);
        setLoadedNoteId(noteId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to fetch unlinked mentions:", error);
        setMentions([]);
        setLoadedNoteId(noteId);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // Don't render if no mentions and not loading
  if (!loading && mentions.length === 0) {
    return null;
  }

  // Highlight the mentioned title in context
  const highlightMention = (context: string) => {
    const lowerContext = context.toLowerCase();
    const lowerTitle = noteTitle.toLowerCase();
    const index = lowerContext.indexOf(lowerTitle);

    if (index === -1) return context;

    const before = context.slice(0, index);
    const match = context.slice(index, index + noteTitle.length);
    const after = context.slice(index + noteTitle.length);

    return (
      <>
        {before}
        <span
          style={{
            backgroundColor: "var(--color-accent-light)",
            borderRadius: "2px",
            padding: "0 2px",
          }}
        >
          {match}
        </span>
        {after}
      </>
    );
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
            style={{ color: "var(--color-text-secondary)" }}
          >
            Unlinked Mentions
          </span>
          {!loading && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text-tertiary)",
              }}
            >
              {mentions.length}
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

      {/* Mentions list */}
      {isExpanded && !loading && mentions.length > 0 && (
        <div className="px-4 pb-3">
          {mentions.map((mention) => (
            <div
              key={mention.note_id}
              className="px-3 py-2 rounded-lg hover:bg-black/5 transition-colors mb-1"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => onNavigate(mention.note_id)}
                  className="text-sm font-medium truncate hover:underline text-left"
                  style={{ color: "var(--color-text)" }}
                >
                  {mention.note_title}
                </button>
                {onLinkMention && (
                  <button
                    onClick={() => onLinkMention(mention.note_id, noteTitle)}
                    className="text-xs px-2 py-0.5 rounded shrink-0 hover:bg-black/10 transition-colors"
                    style={{
                      color: "var(--color-accent)",
                      border: "1px solid var(--color-accent)",
                    }}
                    title={`Convert "${noteTitle}" to [[${noteTitle}]]`}
                  >
                    Link
                  </button>
                )}
              </div>
              <div
                className="text-xs mt-1 line-clamp-2"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {highlightMention(mention.context)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
