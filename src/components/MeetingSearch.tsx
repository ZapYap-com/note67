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
      await onSearch(inputValue);
    },
    [inputValue, onSearch]
  );

  const handleClear = useCallback(() => {
    setInputValue("");
    onClear();
  }, [onClear]);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search meetings..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-500" />
          </div>
        )}
      </div>
      {searchQuery && (
        <button
          type="button"
          onClick={handleClear}
          className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          Clear
        </button>
      )}
      <button
        type="submit"
        disabled={isSearching}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium
                   hover:bg-blue-700 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Search
      </button>
    </form>
  );
}
