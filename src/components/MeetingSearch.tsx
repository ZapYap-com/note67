import { useState, useCallback } from "react";

interface MeetingSearchProps {
  searchQuery: string;
  isSearching: boolean;
  onSearch: (query: string) => Promise<void>;
  onClear: () => void;
}

export function MeetingSearch({
  searchQuery,
  isSearching,
  onSearch,
  onClear,
}: MeetingSearchProps) {
  const [inputValue, setInputValue] = useState(searchQuery);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (inputValue.trim()) {
        await onSearch(inputValue);
      }
    },
    [inputValue, onSearch]
  );

  const handleClear = useCallback(() => {
    setInputValue("");
    onClear();
  }, [onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear]
  );

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {/* Search Icon */}
        <svg
          className="w-4 h-4 shrink-0"
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

        {/* Input */}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search meetings..."
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: "var(--color-text)" }}
        />

        {/* Loading / Clear */}
        {isSearching ? (
          <div
            className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin shrink-0"
            style={{
              borderColor: "var(--color-text-tertiary)",
              borderTopColor: "transparent",
            }}
          />
        ) : searchQuery ? (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs shrink-0 px-2 py-1 rounded-md transition-colors"
            style={{
              color: "var(--color-text-tertiary)",
              backgroundColor: "var(--color-bg-subtle)",
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
