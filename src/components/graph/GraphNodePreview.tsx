import { useEffect, useState } from "react";
import { notesApi } from "../../api/notes";
import type { Note } from "../../types";

interface GraphNodePreviewProps {
  nodeId: string;
}

export function GraphNodePreview({ nodeId }: GraphNodePreviewProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Fetch note data
  useEffect(() => {
    let cancelled = false;

    const fetchNote = async () => {
      try {
        const data = await notesApi.get(nodeId);
        if (!cancelled) {
          setNote(data);
        }
      } catch (error) {
        console.error("Failed to fetch note for preview:", error);
        if (!cancelled) {
          setNote(null);
        }
      }
    };

    fetchNote();

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (!note) return null;

  // Strip markdown for plain text preview
  const getSnippet = (content: string | null) => {
    if (!content) return "No content";
    const plainText = content
      .replace(/#{1,6}\s/g, "")
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
      .replace(/\[{2}([^\]|]+)(?:\|[^\]]+)?\]{2}/g, "$1") // [[links]]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\n+/g, " ")
      .trim();
    return plainText.length > 150 ? plainText.slice(0, 150) + "..." : plainText;
  };

  // Adjust position to stay within viewport
  const adjustedPosition = {
    left: Math.min(position.x + 16, window.innerWidth - 280),
    top: Math.min(position.y + 16, window.innerHeight - 120),
  };

  return (
    <div
      className="fixed z-50 w-64 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg pointer-events-none"
      style={{
        left: adjustedPosition.left,
        top: adjustedPosition.top,
      }}
    >
      <h4 className="font-medium text-sm text-[var(--color-text)] mb-1 truncate">
        {note.title}
      </h4>
      <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3">
        {getSnippet(note.description)}
      </p>
    </div>
  );
}
