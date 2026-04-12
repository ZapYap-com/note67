import { useState, useEffect, useRef, useCallback } from "react";
import { notesApi } from "../api/notes";
import type { Note } from "../types";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
}

export function SearchModal({ isOpen, onClose, onSelectNote }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Note[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await notesApi.search(query);
        setResults(searchResults);
        setSelectedIndex(0);
      } catch (error) {
        console.error("Search failed:", error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;

    const selectedItem = container.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((noteId: string) => {
    onSelectNote(noteId);
    onClose();
  }, [onSelectNote, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < results.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : results.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex].id);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }, [results, selectedIndex, handleSelect, onClose]);

  // Highlight matching text in title/description
  const highlightMatch = (text: string, searchQuery: string) => {
    if (!searchQuery.trim() || !text) return text;

    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          style={{
            backgroundColor: "var(--color-accent-light)",
            color: "var(--color-accent)",
            borderRadius: "2px",
            padding: "0 2px",
          }}
        >
          {part}
        </mark>
      ) : part
    );
  };

  // Get snippet from description
  const getSnippet = (description: string | null, searchQuery: string, maxLength = 100) => {
    if (!description) return null;

    const lowerDesc = description.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    const index = lowerDesc.indexOf(lowerQuery);

    if (index === -1) {
      return description.slice(0, maxLength) + (description.length > maxLength ? "..." : "");
    }

    const start = Math.max(0, index - 30);
    const end = Math.min(description.length, index + searchQuery.length + 70);
    let snippet = description.slice(start, end);

    if (start > 0) snippet = "..." + snippet;
    if (end < description.length) snippet = snippet + "...";

    return snippet;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <svg
            className="w-5 h-5 shrink-0"
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
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes..."
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: "var(--color-text)" }}
          />
          {isSearching && (
            <div
              className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
              style={{
                borderColor: "var(--color-text-tertiary)",
                borderTopColor: "transparent",
              }}
            />
          )}
          <kbd
            className="px-1.5 py-0.5 text-xs rounded"
            style={{
              backgroundColor: "var(--color-bg-subtle)",
              color: "var(--color-text-tertiary)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={resultsRef}
          className="max-h-[50vh] overflow-y-auto"
        >
          {query.trim() && results.length === 0 && !isSearching && (
            <div
              className="px-4 py-8 text-center text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              No notes found for "{query}"
            </div>
          )}

          {results.map((note, index) => {
            const snippet = getSnippet(note.description, query);
            const isSelected = index === selectedIndex;

            return (
              <button
                key={note.id}
                onClick={() => handleSelect(note.id)}
                className="w-full px-4 py-3 text-left flex flex-col gap-1 transition-colors"
                style={{
                  backgroundColor: isSelected ? "var(--color-sidebar-selected)" : "transparent",
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-medium truncate"
                    style={{ color: "var(--color-text)" }}
                  >
                    {highlightMatch(note.title, query)}
                  </span>
                  <span
                    className="text-xs shrink-0"
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    {formatDate(note.started_at)}
                  </span>
                </div>
                {snippet && (
                  <p
                    className="text-sm truncate"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {highlightMatch(snippet, query)}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div
            className="px-4 py-2 border-t flex items-center gap-4 text-xs"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-tertiary)",
            }}
          >
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: "var(--color-bg-subtle)" }}>↑</kbd>
              <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: "var(--color-bg-subtle)" }}>↓</kbd>
              to navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-bg-subtle)" }}>↵</kbd>
              to open
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
