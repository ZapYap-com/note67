import type { TranscriptSegment } from "../types";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  isLoading?: boolean;
}

export function TranscriptViewer({ segments, isLoading }: TranscriptViewerProps) {
  if (isLoading) {
    return (
      <div className="text-center py-4 text-gray-500 dark:text-gray-400">
        <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-500 mr-2" />
        Transcribing...
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <p className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
        No transcript available.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {segments.map((segment) => (
        <TranscriptSegmentRow key={segment.id} segment={segment} />
      ))}
    </div>
  );
}

function TranscriptSegmentRow({ segment }: { segment: TranscriptSegment }) {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex gap-3 text-sm">
      <span className="text-gray-400 dark:text-gray-500 font-mono shrink-0">
        {formatTime(segment.start_time)}
      </span>
      <p className="text-gray-700 dark:text-gray-300">{segment.text}</p>
    </div>
  );
}
