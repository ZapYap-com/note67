import { useState, useRef, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { UploadedAudio, AudioSegment, AudioItem } from "../types";
import { uploadApi } from "../api/upload";

interface AudioFilesListProps {
  uploads: UploadedAudio[];
  segments: AudioSegment[];
  isTranscribing: boolean;
  onTranscribe: (uploadId: number) => void;
  onDeleteUpload: (uploadId: number) => void;
  onReorder?: () => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: UploadedAudio["transcription_status"] }) {
  const styles: Record<string, { bg: string; text: string }> = {
    pending: { bg: "rgba(234, 179, 8, 0.15)", text: "#ca8a04" },
    processing: { bg: "rgba(59, 130, 246, 0.15)", text: "#2563eb" },
    completed: { bg: "rgba(34, 197, 94, 0.15)", text: "#16a34a" },
    failed: { bg: "rgba(239, 68, 68, 0.15)", text: "#dc2626" },
  };
  const style = styles[status] || styles.pending;

  return (
    <span
      className="px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {status}
    </span>
  );
}

function PlayButton({ isPlaying, onPlay, onPause }: {
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
}) {
  return (
    <button
      onClick={() => isPlaying ? onPause() : onPlay()}
      className="p-1.5 rounded-full transition-colors"
      style={{ backgroundColor: "var(--color-accent-light)" }}
      title={isPlaying ? "Pause" : "Play"}
    >
      {isPlaying ? (
        <svg className="w-3.5 h-3.5" style={{ color: "var(--color-accent)" }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" style={{ color: "var(--color-accent)" }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  );
}

function MoveButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={onMoveUp}
        disabled={!canMoveUp}
        className="p-0.5 rounded hover:bg-black/5 transition-colors disabled:opacity-30"
        title="Move up"
      >
        <svg className="w-3 h-3" style={{ color: "var(--color-text-tertiary)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        onClick={onMoveDown}
        disabled={!canMoveDown}
        className="p-0.5 rounded hover:bg-black/5 transition-colors disabled:opacity-30"
        title="Move down"
      >
        <svg className="w-3 h-3" style={{ color: "var(--color-text-tertiary)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}

export function AudioFilesList({
  uploads,
  segments,
  isTranscribing,
  onTranscribe,
  onDeleteUpload,
  onReorder,
}: AudioFilesListProps) {
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Combine segments and uploads into a single sorted list
  const items = useMemo<AudioItem[]>(() => {
    console.log("[AudioFilesList] segments:", segments.length, "uploads:", uploads.length);
    const segmentItems: AudioItem[] = segments.map((s) => ({ type: "segment" as const, data: s }));
    const uploadItems: AudioItem[] = uploads.map((u) => ({ type: "upload" as const, data: u }));
    const all = [...segmentItems, ...uploadItems];
    return all.sort((a, b) => a.data.display_order - b.data.display_order);
  }, [segments, uploads]);

  const handlePlay = (filePath: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(convertFileSrc(filePath));
    audio.onended = () => setPlayingPath(null);
    audio.onerror = () => setPlayingPath(null);
    audio.play();
    audioRef.current = audio;
    setPlayingPath(filePath);
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingPath(null);
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    // Swap items
    const newItems = [...items];
    [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];

    // Build reorder data
    const reorderData = newItems.map((item, idx) => ({
      item_type: item.type,
      id: item.data.id,
      order: idx,
    }));

    try {
      await uploadApi.reorderItems(reorderData);
      onReorder?.();
    } catch (err) {
      console.error("Failed to reorder items:", err);
    }
  };

  const getItemPath = (item: AudioItem): string => {
    if (item.type === "segment") {
      return item.data.mic_path;
    }
    return item.data.file_path;
  };

  if (items.length === 0) return null;

  return (
    <div
      className="mt-4 pt-4 border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <h3
        className="text-sm font-medium mb-2"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Audio Files ({items.length})
      </h3>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const path = getItemPath(item);
          const isPlaying = playingPath === path;
          const canMoveUp = index > 0;
          const canMoveDown = index < items.length - 1;

          if (item.type === "segment") {
            const segment = item.data;
            return (
              <li
                key={`seg-${segment.id}`}
                className="flex items-center gap-2 p-2 rounded-lg"
                style={{ backgroundColor: "var(--color-sidebar)" }}
              >
                <span
                  className="w-5 h-5 flex items-center justify-center text-xs font-medium rounded"
                  style={{ backgroundColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                >
                  {index + 1}
                </span>
                <MoveButtons
                  canMoveUp={canMoveUp}
                  canMoveDown={canMoveDown}
                  onMoveUp={() => handleMove(index, "up")}
                  onMoveDown={() => handleMove(index, "down")}
                />
                <PlayButton
                  isPlaying={isPlaying}
                  onPlay={() => handlePlay(segment.mic_path)}
                  onPause={handlePause}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--color-text)" }}
                  >
                    Recording {segment.segment_index + 1}
                  </p>
                  <div
                    className="flex items-center gap-2 mt-0.5 text-xs"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {segment.duration_ms && segment.duration_ms > 0 && (
                      <span>{formatDuration(segment.duration_ms)}</span>
                    )}
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: "var(--color-accent-light)", color: "var(--color-accent)" }}
                    >
                      Recorded
                    </span>
                  </div>
                </div>
              </li>
            );
          }

          // Upload item
          const upload = item.data;
          return (
            <li
              key={`upload-${upload.id}`}
              className="flex items-center gap-2 p-2 rounded-lg"
              style={{ backgroundColor: "var(--color-sidebar)" }}
            >
              <span
                className="w-5 h-5 flex items-center justify-center text-xs font-medium rounded"
                style={{ backgroundColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
              >
                {index + 1}
              </span>
              <MoveButtons
                canMoveUp={canMoveUp}
                canMoveDown={canMoveDown}
                onMoveUp={() => handleMove(index, "up")}
                onMoveDown={() => handleMove(index, "down")}
              />
              <PlayButton
                isPlaying={isPlaying}
                onPlay={() => handlePlay(upload.file_path)}
                onPause={handlePause}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--color-text)" }}
                >
                  {upload.original_filename}
                </p>
                <div
                  className="flex items-center gap-2 mt-0.5 text-xs"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {upload.duration_ms && upload.duration_ms > 0 && (
                    <span>{formatDuration(upload.duration_ms)}</span>
                  )}
                  <span>Speaker: {upload.speaker_label}</span>
                  <StatusBadge status={upload.transcription_status} />
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {upload.transcription_status === "pending" && (
                  <button
                    onClick={() => onTranscribe(upload.id)}
                    disabled={isTranscribing}
                    className="px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {isTranscribing ? "..." : "Transcribe"}
                  </button>
                )}
                {upload.transcription_status === "failed" && (
                  <button
                    onClick={() => onTranscribe(upload.id)}
                    disabled={isTranscribing}
                    className="px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    Retry
                  </button>
                )}
                {upload.transcription_status === "processing" && (
                  <div
                    className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                    style={{
                      borderColor: "var(--color-accent)",
                      borderTopColor: "transparent",
                    }}
                  />
                )}
                <button
                  onClick={() => onDeleteUpload(upload.id)}
                  className="p-1 rounded hover:bg-black/5 transition-colors"
                  title="Delete"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    style={{ color: "var(--color-text-tertiary)" }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
