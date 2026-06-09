import { useState, useMemo, useRef, useEffect } from "react";
import type { TranscriptSegment, AudioSegment, UploadedAudio, AudioItem } from "../types";

type SpeakerFilter = "all" | "you" | "others";

// Common abbreviations that end in "." but don't end a sentence. Kept
// collision-free (no "no"/"co" etc. which are also ordinary words).
const SENTENCE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc",
  "e.g", "i.e", "a.m", "p.m", "u.s", "u.k",
]);

// Split a speaker turn into sentences so each line is a complete thought,
// rather than an arbitrary ~5s Whisper segment that may break mid-sentence.
// Breaks on sentence-ending punctuation (. ! ?) followed by whitespace, but not
// after a known abbreviation ("Mr.", "e.g.") or a decimal like "3.5" (no space
// after the dot). Trailing text without punctuation is kept.
function splitIntoSentences(text: string): string[] {
  return text
    .replace(/([.!?]+)(\s+)/g, (match: string, _punct: string, _space: string, offset: number, full: string) => {
      const prevWord = full.slice(0, offset).split(/\s+/).pop()?.toLowerCase() ?? "";
      return SENTENCE_ABBREVIATIONS.has(prevWord) ? match : `${match.trimEnd()}\n`;
    })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Show an interval timestamp inside a speaker turn whenever a sentence crosses
// into a new bucket of this many seconds (so long monologues stay navigable).
const TIMESTAMP_INTERVAL_SECONDS = 30;

interface SentenceLine {
  text: string;
  startTime: number;
}

// Split a speaker turn into sentences and map each one back to a real start
// time. Each segment carries its own start_time; a sentence is attributed to the
// segment that was being spoken at the sentence's character offset in the turn.
function buildSentenceLines(segments: TranscriptSegment[]): SentenceLine[] {
  if (segments.length === 0) return [];

  const fullText = segments.map((s) => s.text).join(" ");

  // Character offset where each segment's text begins in fullText.
  const segPositions: { charStart: number; time: number }[] = [];
  let pos = 0;
  for (const seg of segments) {
    segPositions.push({ charStart: pos, time: seg.start_time });
    pos += seg.text.length + 1; // +1 for the join space
  }
  const timeAtOffset = (offset: number): number => {
    let time = segments[0].start_time;
    for (const p of segPositions) {
      if (p.charStart <= offset) time = p.time;
      else break;
    }
    return time;
  };

  const lines: SentenceLine[] = [];
  let searchFrom = 0;
  for (const sentence of splitIntoSentences(fullText)) {
    const idx = fullText.indexOf(sentence, searchFrom);
    const charOffset = idx >= 0 ? idx : searchFrom;
    lines.push({ text: sentence, startTime: timeAtOffset(charOffset) });
    searchFrom = charOffset + sentence.length;
  }
  return lines;
}

interface GroupedSegment {
  speaker: string | null;
  startTime: number;
  texts: string[];
  ids: number[];
  segments: TranscriptSegment[];
}

interface AudioSourceSection {
  key: string;
  label: string;
  sourceType: string | null;
  sourceId: number | null;
  displayOrder: number;
  transcripts: TranscriptSegment[];
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

function groupTranscriptsBySource(
  segments: TranscriptSegment[],
  audioSegments: AudioSegment[],
  uploads: UploadedAudio[]
): AudioSourceSection[] {
  // Build audio items list sorted by display_order
  const audioItems: AudioItem[] = [
    ...audioSegments.map((s) => ({ type: "segment" as const, data: s })),
    ...uploads.map((u) => ({ type: "upload" as const, data: u })),
  ].sort((a, b) => a.data.display_order - b.data.display_order);

  // Create a map for quick lookup of display_order
  const orderMap = new Map<string, { order: number; label: string }>();
  audioItems.forEach((item, index) => {
    if (item.type === "segment") {
      const key = `segment-${item.data.id}`;
      orderMap.set(key, {
        order: index,
        label: `Recording ${item.data.segment_index + 1}`,
      });
    } else {
      const key = `upload-${item.data.id}`;
      orderMap.set(key, {
        order: index,
        label: item.data.original_filename,
      });
    }
  });

  // Group transcripts by source
  const sourceGroups = new Map<string, AudioSourceSection>();

  for (const segment of segments) {
    let key: string;
    let label: string;
    let displayOrder: number;

    if (segment.source_type === "upload" && segment.source_id !== null) {
      key = `upload-${segment.source_id}`;
      const info = orderMap.get(key);
      label = info?.label || "Uploaded Audio";
      displayOrder = info?.order ?? 999;
    } else if (segment.source_type === "segment" && segment.source_id !== null) {
      key = `segment-${segment.source_id}`;
      const info = orderMap.get(key);
      label = info?.label || "Recording";
      displayOrder = info?.order ?? 999;
    } else if (segment.source_type === "live") {
      // Live transcripts - group with the current recording session
      key = "live";
      label = "Live Transcription";
      displayOrder = -1; // Show at top during recording
    } else {
      // Legacy transcripts without source info
      key = "legacy";
      label = "Transcript";
      displayOrder = 1000;
    }

    if (!sourceGroups.has(key)) {
      sourceGroups.set(key, {
        key,
        label,
        sourceType: segment.source_type,
        sourceId: segment.source_id,
        displayOrder,
        transcripts: [],
      });
    }
    sourceGroups.get(key)!.transcripts.push(segment);
  }

  // Sort sections by display_order, then sort transcripts within each section by start_time
  const sections = Array.from(sourceGroups.values())
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((section) => ({
      ...section,
      transcripts: section.transcripts.sort((a, b) => a.start_time - b.start_time),
    }));

  return sections;
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
  audioSegments?: AudioSegment[];
  uploads?: UploadedAudio[];
  onSegmentClick?: (segment: TranscriptSegment) => void;
  isLive?: boolean;
}

export function TranscriptSearch({
  segments,
  audioSegments = [],
  uploads = [],
  onSegmentClick,
  isLive = false,
}: TranscriptSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<SpeakerFilter>("all");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Signature that changes whenever transcript content grows — captures both
  // new segments and text appended to the last segment, so auto-scroll keeps
  // up even during a long single-speaker monologue (where the segment count
  // may not change between updates).
  const contentSignature = `${segments.length}:${segments[segments.length - 1]?.text ?? ""}`;
  const prevSignatureRef = useRef(contentSignature);

  // Check if we have speaker data in any segment
  const hasSpeakerData = useMemo(() => {
    return segments.some((s) => s.speaker !== null);
  }, [segments]);

  // Auto-scroll to bottom when transcript content grows (only in live mode)
  useEffect(() => {
    if (isLive && contentSignature !== prevSignatureRef.current) {
      const el = scrollContainerRef.current;
      el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    prevSignatureRef.current = contentSignature;
  }, [contentSignature, isLive]);

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

  // Group transcripts by audio source, then by consecutive speaker
  const sourceSections = useMemo(
    () => groupTranscriptsBySource(filteredSegments, audioSegments, uploads),
    [filteredSegments, audioSegments, uploads]
  );

  // Check if we have multiple sources (to decide whether to show section headers)
  const hasMultipleSources = sourceSections.length > 1;

  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    // Escape regex metacharacters so searches like "C++", "(", or "*" don't
    // throw or mis-highlight (the query is raw user input).
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
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
    <div className="flex flex-col h-full">
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
        <div className="flex items-center gap-2 mt-4">
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
        <p className="text-sm mt-4" style={{ color: "var(--color-text-secondary)" }}>
          {filteredSegments.length} of {segments.length} segments
          {speakerFilter !== "all" && ` (${speakerFilter === "you" ? "You" : "Others"})`}
        </p>
      )}

      {/* Segments grouped by audio source */}
      <div ref={scrollContainerRef} className="flex-1 space-y-4 overflow-y-auto mt-4">
        {sourceSections.map((section) => {
          const groupedSegments = groupConsecutiveSegments(section.transcripts);
          return (
            <div key={section.key} className="space-y-2">
              {/* Section header - only show if multiple sources */}
              {hasMultipleSources && (
                <div
                  className="sticky top-0 z-10 px-3 py-1.5 text-xs font-medium rounded-lg"
                  style={{
                    backgroundColor: "var(--color-bg-elevated)",
                    color: "var(--color-text-secondary)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {section.label}
                </div>
              )}
              {/* Transcript segments within this source */}
              {groupedSegments.map((group) => {
                const lines = buildSentenceLines(group.segments);
                let lastBucket = -1;
                return (
                  <div
                    key={group.ids[0]}
                    onClick={() => onSegmentClick?.(group.segments[0])}
                    className="w-full text-left px-4 py-3 rounded-xl transition-colors hover:bg-black/5 cursor-pointer"
                  >
                    {group.speaker && (
                      <div className="flex gap-4 mb-1">
                        <span className="w-14 shrink-0" aria-hidden="true" />
                        <SpeakerLabel speaker={group.speaker} />
                      </div>
                    )}
                    {/* One line per sentence (reads as prose); a timestamp is
                        shown whenever a sentence crosses a new 30s boundary so a
                        long single-speaker turn stays navigable. */}
                    <div className="space-y-1.5">
                      {lines.map((line, i) => {
                        const bucket = Math.floor(line.startTime / TIMESTAMP_INTERVAL_SECONDS);
                        const showTime = i === 0 || bucket !== lastBucket;
                        lastBucket = bucket;
                        return (
                          <div key={`${group.ids[0]}-${i}`} className="flex gap-4">
                            <span
                              className="w-14 shrink-0 text-sm font-mono pt-0.5"
                              style={{ color: "var(--color-text-secondary)" }}
                            >
                              {showTime ? formatTime(line.startTime) : ""}
                            </span>
                            <p
                              className="flex-1 min-w-0 leading-relaxed"
                              style={{ color: "var(--color-text)" }}
                            >
                              {highlightMatch(line.text, searchQuery)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {sourceSections.length === 0 && searchQuery && (
          <p className="text-center py-8" style={{ color: "var(--color-text-secondary)" }}>
            No matches found.
          </p>
        )}
      </div>
    </div>
  );
}
