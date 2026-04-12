import { useEffect, useRef, useCallback } from "react";
import type { BacklinkNote } from "../types";

interface LinkAutocompleteProps {
  notes: BacklinkNote[];
  query: string;
  position: { top: number; left: number };
  selectedIndex: number;
  onSelect: (noteTitle: string) => void;
  onClose: () => void;
}

export function LinkAutocomplete({
  notes,
  query,
  position,
  selectedIndex,
  onSelect,
  onClose,
}: LinkAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Filter notes by prefix match
  const filteredNotes = notes.filter((note) =>
    note.title.toLowerCase().startsWith(query.toLowerCase())
  );

  // Limit to 6 visible suggestions
  const visibleNotes = filteredNotes.slice(0, 6);

  // Scroll selected item into view
  useEffect(() => {
    const selectedItem = itemRefs.current[selectedIndex];
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleSelect = useCallback(
    (noteTitle: string) => {
      onSelect(noteTitle);
    },
    [onSelect]
  );

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

  // Get description snippet
  const getSnippet = (description: string | null, maxLength = 50) => {
    if (!description) return null;
    if (description.length <= maxLength) return description;
    return description.slice(0, maxLength).trim() + "...";
  };

  if (visibleNotes.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="link-autocomplete fixed z-[100] py-1 rounded-lg shadow-lg"
      style={{
        top: position.top,
        left: position.left,
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        minWidth: "200px",
        maxWidth: "320px",
      }}
    >
      {visibleNotes.map((note, index) => {
        const isSelected = index === selectedIndex;

        return (
          <button
            key={note.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent focus change
              e.stopPropagation();
              handleSelect(note.title);
            }}
            className="w-full px-3 py-2 text-left text-sm transition-colors"
            style={{
              backgroundColor: isSelected ? "var(--color-sidebar-selected)" : "transparent",
              color: "var(--color-text)",
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            {/* Note title */}
            <div className="font-medium truncate">{note.title}</div>
            {/* Description snippet and date */}
            <div
              className="flex items-center gap-2 text-xs mt-0.5"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {note.description && (
                <span className="truncate flex-1">
                  {getSnippet(note.description)}
                </span>
              )}
              <span className="shrink-0">{formatDate(note.started_at)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
