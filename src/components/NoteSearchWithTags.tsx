import { useState, useRef, useEffect } from "react";
import type { Tag } from "../types";
import { getTagColor } from "../utils/tagColors";

interface NoteSearchWithTagsProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  tags: Tag[];
  selectedTag: string | null;
  onTagSelect: (tagName: string | null) => void;
}

export function NoteSearchWithTags({
  searchQuery,
  onSearchChange,
  tags,
  selectedTag,
  onTagSelect,
}: NoteSearchWithTagsProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDropdown]);

  const handleTagClick = (tagName: string) => {
    if (selectedTag === tagName) {
      onTagSelect(null);
    } else {
      onTagSelect(tagName);
    }
    setShowDropdown(false);
  };

  const handleClearTag = () => {
    onTagSelect(null);
  };

  return (
    <div className="px-4 py-2">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Search Icon */}
        <svg
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: "var(--color-text-tertiary)" }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>

        {/* Search Input */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="flex-1 bg-transparent outline-none text-xs min-w-0"
          style={{ color: "var(--color-text)" }}
        />

        {/* Selected Tag Badge */}
        {selectedTag && (
          <button
            onClick={handleClearTag}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            #{selectedTag}
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Filter Button */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="p-1 rounded transition-colors shrink-0"
            style={{
              color: tags.length > 0 ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
            }}
            title="Filter by tag"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
          </button>

          {/* Dropdown */}
          {showDropdown && tags.length > 0 && (
            <div
              className="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg min-w-[140px] max-h-[200px] overflow-y-auto z-50"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              {selectedTag && (
                <>
                  <button
                    onClick={() => {
                      onTagSelect(null);
                      setShowDropdown(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 flex items-center gap-2"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Clear filter
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
                </>
              )}
              {tags.map((tag) => {
                const tagColor = getTagColor(tag.name);
                return (
                  <button
                    key={tag.id}
                    onClick={() => handleTagClick(tag.name)}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 flex items-center gap-2"
                    style={{
                      color: selectedTag === tag.name ? "var(--color-accent)" : "var(--color-text)",
                      backgroundColor: selectedTag === tag.name ? "var(--color-accent-light)" : "transparent",
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: tagColor }}
                    />
                    <span className="flex-1">#{tag.name}</span>
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
          )}
        </div>
      </div>
    </div>
  );
}
