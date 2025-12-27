import { useState, useMemo, useRef, useEffect } from "react";
import type { TranscriptSegment } from "../types";

type SpeakerFilter = "all" | "you" | "others";

interface GroupedSegment {
  speaker: string | null;
  startTime: number;
  texts: string[];
  ids: number[];
  segments: TranscriptSegment[];
}

function groupConsecutiveSegments(segments: TranscriptSegment[]): GroupedSegment[] {
  if (segments.length === 0) return [];

  const groups: GroupedSegment[] = [];
  let currentGroup: GroupedSegment | null = null;

  for (const segment of segments) {
    if (currentGroup && currentGroup.speaker === segment.speaker) {
      // Same speaker, add to current group
      currentGroup.texts.push(segment.text);
      currentGroup.ids.push(segment.id);
      currentGroup.segments.push(segment);
    } else {
      // Different speaker, start new group
      currentGroup = {
        speaker: segment.speaker,
        startTime: segment.start_time,
        texts: [segment.text],
        ids: [segment.id],
        segments: [segment],
      };
      groups.push(currentGroup);
    }
  }

  return groups;
}

function SpeakerLabel({ speaker }: { speaker: string | null }) {
  if (!speaker) return null;

  // "Me" or profile name are considered "you"
  const isYou = speaker !== "Others";
  return (
    <span
      className="text-xs font-medium"
      style={{
        color: isYou ? "var(--color-accent)" : "var(--color-text-secondary)",
      }}
    >
      {speaker}
    </span>
  );
}

interface TranscriptSearchProps {
  segments: TranscriptSegment[];
  onSegmentClick?: (segment: TranscriptSegment) => void;
  isLive?: boolean;
}

export function TranscriptSearch({ segments, onSegmentClick, isLive = false }: TranscriptSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<SpeakerFilter>("all");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevSegmentCountRef = useRef(segments.length);

  // Check if we have speaker data in any segment
  const hasSpeakerData = useMemo(() => {
    return segments.some((s) => s.speaker !== null);
  }, [segments]);

  // Auto-scroll to bottom when new segments arrive (only in live mode)
  useEffect(() => {
    if (isLive && segments.length > prevSegmentCountRef.current) {
      scrollContainerRef.current?.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
    prevSegmentCountRef.current = segments.length;
  }, [segments.length, isLive]);

  const filteredSegments = useMemo(() => {
    let result = segments;

    // Filter by speaker
    if (speakerFilter !== "all") {
      result = result.filter((s) => {
        if (speakerFilter === "you") {
          // "You" includes any speaker that isn't "Others"
          return s.speaker !== null && s.speaker !== "Others";
        } else {
          // "Others" is specifically the "Others" speaker
          return s.speaker === "Others";
        }
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((s) => s.text.toLowerCase().includes(query));
    }

    return result;
  }, [segments, searchQuery, speakerFilter]);

  // Group consecutive segments by speaker
  const groupedSegments = useMemo(
    () => groupConsecutiveSegments(filteredSegments),
    [filteredSegments]
  );

  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark
          key={i}
          className="rounded px-0.5"
          style={{ backgroundColor: "#fef08a", color: "var(--color-text)" }}
        >
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
      <p className="text-center py-8" style={{ color: "var(--color-text-secondary)" }}>
        No transcript available.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{ backgroundColor: "var(--color-sidebar)", border: "1px solid var(--color-border)" }}
      >
        <svg
          className="w-5 h-5 shrink-0"
          style={{ color: "var(--color-text-secondary)" }}
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
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search transcript..."
          className="flex-1 bg-transparent"
          style={{ color: "var(--color-text)" }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="shrink-0"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Speaker Filter (only show if we have speaker data) */}
      {hasSpeakerData && (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
            Speaker:
          </span>
          <div className="flex gap-1">
            {(["all", "you", "others"] as SpeakerFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setSpeakerFilter(filter)}
                className="px-3 py-1 text-xs font-medium rounded-full transition-colors"
                style={{
                  backgroundColor:
                    speakerFilter === filter
                      ? filter === "you"
                        ? "var(--color-accent-light)"
                        : filter === "others"
                        ? "rgba(100, 116, 139, 0.15)"
                        : "var(--color-bg-elevated)"
                      : "var(--color-bg-subtle)",
                  color:
                    speakerFilter === filter
                      ? filter === "you"
                        ? "var(--color-accent)"
                        : filter === "others"
                        ? "var(--color-text-secondary)"
                        : "var(--color-text)"
                      : "var(--color-text-tertiary)",
                  border:
                    speakerFilter === filter
                      ? filter === "you"
                        ? "1px solid var(--color-accent)"
                        : filter === "others"
                        ? "1px solid var(--color-text-secondary)"
                        : "1px solid var(--color-border)"
                      : "1px solid transparent",
                }}
              >
                {filter === "all" ? "All" : filter === "you" ? "You" : "Others"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results count */}
      {(searchQuery || speakerFilter !== "all") && (
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {filteredSegments.length} of {segments.length} segments
          {speakerFilter !== "all" && ` (${speakerFilter === "you" ? "You" : "Others"})`}
        </p>
      )}

      {/* Segments */}
      <div ref={scrollContainerRef} className="space-y-2 max-h-[60vh] overflow-y-auto">
        {groupedSegments.map((group) => {
          const combinedText = group.texts.join(" ");
          return (
            <div
              key={group.ids[0]}
              onClick={() => onSegmentClick?.(group.segments[0])}
              className="w-full flex gap-4 text-left px-4 py-3 rounded-xl transition-colors hover:bg-black/5 cursor-pointer"
            >
              <span
                className="text-sm font-mono shrink-0 pt-0.5"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {formatTime(group.startTime)}
              </span>
              <div className="flex-1 min-w-0">
                {group.speaker && (
                  <div className="mb-0.5">
                    <SpeakerLabel speaker={group.speaker} />
                  </div>
                )}
                <p className="leading-relaxed" style={{ color: "var(--color-text)" }}>
                  {highlightMatch(combinedText, searchQuery)}
                </p>
              </div>
            </div>
          );
        })}
        {groupedSegments.length === 0 && searchQuery && (
          <p className="text-center py-8" style={{ color: "var(--color-text-secondary)" }}>
            No matches found.
          </p>
        )}
      </div>
    </div>
  );
}
