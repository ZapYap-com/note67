import { useEffect, useState } from "react";
import { linksApi } from "../api/links";
import type { BacklinkNote } from "../types";

interface LinkPreviewProps {
  noteTitle: string;
  position: { top: number; left: number };
  onClose: () => void;
  onNavigate?: (noteId: string) => void;
}

export function LinkPreview({ noteTitle, position, onClose, onNavigate }: LinkPreviewProps) {
  const [note, setNote] = useState<BacklinkNote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchNote = async () => {
      try {
        // Search for note by title
        const results = await linksApi.searchNotesByTitle(noteTitle);
        if (cancelled) return;

        // Find exact match (case-insensitive)
        const match = results.find(
          n => n.title.toLowerCase() === noteTitle.toLowerCase()
        );
        setNote(match || null);
      } catch (error) {
        console.error("Failed to fetch note for preview:", error);
        setNote(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchNote();

    return () => {
      cancelled = true;
    };
  }, [noteTitle]);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedPosition = {
    top: Math.min(position.top, window.innerHeight - 150),
    left: Math.min(position.left, window.innerWidth - 300),
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getSnippet = (description: string | null | undefined) => {
    if (!description) return "No content";
    // Remove markdown formatting and truncate
    const plainText = description
      .replace(/#{1,6}\s/g, "")
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
    return plainText.length > 120 ? plainText.slice(0, 120) + "..." : plainText;
  };

  const handleClick = () => {
    if (note && onNavigate) {
      onNavigate(note.id);
      onClose();
    }
  };

  if (loading) {
    return (
      <div
        className="link-preview"
        style={{
          top: adjustedPosition.top,
          left: adjustedPosition.left,
        }}
        onMouseLeave={onClose}
      >
        <div className="link-preview-title">Loading...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div
        className="link-preview"
        style={{
          top: adjustedPosition.top,
          left: adjustedPosition.left,
        }}
        onMouseLeave={onClose}
      >
        <div className="link-preview-title" style={{ color: "var(--color-text-tertiary)" }}>
          Note not found
        </div>
        <div className="link-preview-snippet">
          "{noteTitle}" does not exist yet
        </div>
      </div>
    );
  }

  return (
    <div
      className="link-preview"
      style={{
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        cursor: onNavigate ? "pointer" : "default",
      }}
      onMouseLeave={onClose}
      onClick={handleClick}
    >
      <div className="link-preview-title">{note.title}</div>
      <div className="link-preview-snippet">{getSnippet(note.description)}</div>
      <div className="link-preview-date">{formatDate(note.started_at)}</div>
      {onNavigate && (
        <div
          className="link-preview-hint"
          style={{
            color: "var(--color-text-tertiary)",
            fontSize: "10px",
            marginTop: "6px",
          }}
        >
          Click to open
        </div>
      )}
    </div>
  );
}
