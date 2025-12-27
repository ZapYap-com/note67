import { useMemo } from "react";
import type { TranscriptSegment } from "../types";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  isLoading?: boolean;
}

interface GroupedSegment {
  speaker: string | null;
  startTime: number;
  texts: string[];
  ids: number[];
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
    } else {
      // Different speaker, start new group
      currentGroup = {
        speaker: segment.speaker,
        startTime: segment.start_time,
        texts: [segment.text],
        ids: [segment.id],
      };
      groups.push(currentGroup);
    }
  }

  return groups;
}

export function TranscriptViewer({ segments, isLoading }: TranscriptViewerProps) {
  const groupedSegments = useMemo(() => groupConsecutiveSegments(segments), [segments]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div
          className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
          style={{
            borderColor: "var(--color-text-tertiary)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <p className="text-center py-8 text-sm" style={{ color: "var(--color-text-tertiary)" }}>
        No transcript available.
      </p>
    );
  }

  return (
    <div className="space-y-3 max-h-80 overflow-y-auto">
      {groupedSegments.map((group) => (
        <GroupedSegmentRow key={group.ids[0]} group={group} />
      ))}
    </div>
  );
}

function SpeakerLabel({ speaker }: { speaker: string | null }) {
  if (!speaker) return null;

  const isYou = speaker === "You";
  return (
    <span
      className="text-xs font-medium shrink-0"
      style={{
        color: isYou ? "var(--color-accent)" : "var(--color-text-secondary)",
      }}
    >
      {speaker}
    </span>
  );
}

function GroupedSegmentRow({ group }: { group: GroupedSegment }) {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Join consecutive texts with a space
  const combinedText = group.texts.join(" ");

  return (
    <div className="flex gap-3 group">
      <span
        className="text-xs font-mono shrink-0 pt-0.5"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {formatTime(group.startTime)}
      </span>
      <div className="flex-1 min-w-0">
        {group.speaker && (
          <div className="mb-0.5">
            <SpeakerLabel speaker={group.speaker} />
          </div>
        )}
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
          {combinedText}
        </p>
      </div>
    </div>
  );
}
