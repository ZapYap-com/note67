import { useEffect, useRef, useCallback } from "react";
import type { Tag } from "../types";
import { getTagColor } from "../utils/tagColors";

interface TagAutocompleteProps {
  tags: Tag[];
  query: string;
  position: { top: number; left: number };
  selectedIndex: number;
  onSelect: (tagName: string) => void;
  onClose: () => void;
  onNavigate?: (direction: "up" | "down") => void;
}

export function TagAutocomplete({
  tags,
  query,
  position,
  selectedIndex,
  onSelect,
  onClose,
}: TagAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Filter tags by prefix match
  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().startsWith(query.toLowerCase())
  );

  // Limit to 6 visible suggestions
  const visibleTags = filteredTags.slice(0, 6);

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

  // Keyboard handling is done in parent component (MarkdownEditor)

  const handleSelect = useCallback(
    (tagName: string) => {
      onSelect(tagName);
    },
    [onSelect]
  );

  if (visibleTags.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="tag-autocomplete fixed z-[100] py-1 rounded-lg shadow-lg"
      style={{
        top: position.top,
        left: position.left,
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        minWidth: "160px",
        maxWidth: "240px",
      }}
    >
      {visibleTags.map((tag, index) => {
        const color = getTagColor(tag.name);
        const isSelected = index === selectedIndex;

        return (
          <button
            key={tag.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onClick={() => handleSelect(tag.name)}
            className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors"
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
            {/* Color dot */}
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            {/* Tag name */}
            <span className="flex-1 truncate">#{tag.name}</span>
            {/* Note count */}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text-tertiary)",
              }}
            >
              {tag.note_count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
