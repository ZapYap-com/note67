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
  onReorder?: () => void; // Called after reorder to refresh data
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
      onClick={isPlaying ? onPause : onPlay}
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

function DragHandle() {
  return (
    <div
      className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-black/5 transition-colors"
      title="Drag to reorder"
    >
      <svg
        className="w-3.5 h-3.5"
        style={{ color: "var(--color-text-tertiary)" }}
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8-16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
      </svg>
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Combine segments and uploads into a single sorted list
  const items = useMemo<AudioItem[]>(() => {
    const segmentItems: AudioItem[] = segments.map((s) => ({ type: "segment" as const, data: s }));
    const uploadItems: AudioItem[] = uploads.map((u) => ({ type: "upload" as const, data: u }));
    const all = [...segmentItems, ...uploadItems];
    // Sort by display_order
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

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Reorder items
    const newItems = [...items];
    const [draggedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(dropIndex, 0, draggedItem);

    // Build reorder data: [itemType, id, newOrder]
    const reorderData: Array<[string, number, number]> = newItems.map((item, idx) => [
      item.type,
      item.data.id,
      idx,
    ]);

    try {
      await uploadApi.reorderItems(reorderData);
      onReorder?.();
    } catch (err) {
      console.error("Failed to reorder items:", err);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
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
        Audio Files
      </h3>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const path = getItemPath(item);
          const isPlaying = playingPath === path;
          const isDragging = draggedIndex === index;
          const isDragOver = dragOverIndex === index;

          if (item.type === "segment") {
            const segment = item.data;
            return (
              <li
                key={`seg-${segment.id}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, index)}
                className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                  isDragging ? "opacity-50" : ""
                } ${isDragOver ? "ring-2 ring-offset-1" : ""}`}
                style={{
                  backgroundColor: "var(--color-sidebar)",
                  ringColor: isDragOver ? "var(--color-accent)" : undefined,
                }}
              >
                <DragHandle />
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
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, index)}
              className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                isDragging ? "opacity-50" : ""
              } ${isDragOver ? "ring-2 ring-offset-1" : ""}`}
              style={{
                backgroundColor: "var(--color-sidebar)",
                ringColor: isDragOver ? "var(--color-accent)" : undefined,
              }}
            >
              <DragHandle />
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
