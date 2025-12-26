import { useState, useMemo } from "react";
import type { TranscriptSegment } from "../types";

interface TranscriptSearchProps {
  segments: TranscriptSegment[];
  onSegmentClick?: (segment: TranscriptSegment) => void;
}

export function TranscriptSearch({ segments, onSegmentClick }: TranscriptSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const query = searchQuery.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(query));
  }, [segments, searchQuery]);

  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (segments.length === 0) {
    return (
      <p className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
        No transcript available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search transcript..."
          className="w-full px-3 py-2 pl-9 text-sm rounded-lg border border-gray-300 dark:border-gray-600
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
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results count */}
      {searchQuery && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {filteredSegments.length} of {segments.length} segments match
        </p>
      )}

      {/* Segments */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {filteredSegments.map((segment) => (
          <button
            key={segment.id}
            onClick={() => onSegmentClick?.(segment)}
            className="w-full flex gap-3 text-sm text-left p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="text-gray-400 dark:text-gray-500 font-mono shrink-0">
              {formatTime(segment.start_time)}
            </span>
            <p className="text-gray-700 dark:text-gray-300">
              {highlightMatch(segment.text, searchQuery)}
            </p>
          </button>
        ))}
        {filteredSegments.length === 0 && searchQuery && (
          <p className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
            No matches found.
          </p>
        )}
      </div>
    </div>
  );
}
