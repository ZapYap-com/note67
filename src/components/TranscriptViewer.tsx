import type { TranscriptSegment } from "../types";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  isLoading?: boolean;
}

export function TranscriptViewer({ segments, isLoading }: TranscriptViewerProps) {
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
      {segments.map((segment) => (
        <TranscriptSegmentRow key={segment.id} segment={segment} />
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

function TranscriptSegmentRow({ segment }: { segment: TranscriptSegment }) {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex gap-3 group">
      <span
        className="text-xs font-mono shrink-0 pt-0.5"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {formatTime(segment.start_time)}
      </span>
      <div className="flex-1 min-w-0">
        {segment.speaker && (
          <div className="mb-0.5">
            <SpeakerLabel speaker={segment.speaker} />
          </div>
        )}
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
          {segment.text}
        </p>
      </div>
    </div>
  );
}
