import type { UploadedAudio } from "../types";

interface UploadedAudioListProps {
  uploads: UploadedAudio[];
  isTranscribing: boolean;
  onTranscribe: (uploadId: number) => void;
  onDelete: (uploadId: number) => void;
  onUpdateSpeaker: (uploadId: number, speakerLabel: string) => void;
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

export function UploadedAudioList({
  uploads,
  isTranscribing,
  onTranscribe,
  onDelete,
}: UploadedAudioListProps) {
  if (uploads.length === 0) return null;

  return (
    <div
      className="mt-4 pt-4 border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <h3
        className="text-sm font-medium mb-2"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Uploaded Audio
      </h3>
      <ul className="space-y-2">
        {uploads.map((upload) => (
          <li
            key={upload.id}
            className="flex items-center justify-between p-2 rounded-lg"
            style={{ backgroundColor: "var(--color-sidebar)" }}
          >
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
            <div className="flex gap-1.5 ml-2 shrink-0">
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
                onClick={() => onDelete(upload.id)}
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
        ))}
      </ul>
    </div>
  );
}
