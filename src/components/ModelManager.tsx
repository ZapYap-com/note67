import { useModels } from "../hooks";
import type { ModelInfo, ModelSize } from "../types";

interface ModelManagerProps {
  onClose: () => void;
}

export function ModelManager({ onClose }: ModelManagerProps) {
  const {
    models,
    loadedModel,
    isDownloading,
    downloadProgress,
    error,
    downloadModel,
    deleteModel,
    loadModel,
  } = useModels();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            Whisper Models
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {error && (
            <div
              className="mb-4 px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", color: "#dc2626" }}
            >
              {error}
            </div>
          )}

          <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
            Download a model for local transcription. Larger models are more accurate but slower.
          </p>

          <div className="space-y-2">
            {models.map((model) => (
              <ModelCard
                key={model.size}
                model={model}
                isLoaded={loadedModel === model.size}
                isDownloading={isDownloading}
                downloadProgress={downloadProgress}
                onDownload={() => downloadModel(model.size)}
                onDelete={() => deleteModel(model.size)}
                onLoad={() => loadModel(model.size)}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 shrink-0"
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-subtle)",
          }}
        >
          <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
            {loadedModel ? `Active: ${loadedModel}` : "No model loaded"}
          </p>
        </div>
      </div>
    </div>
  );
}

interface ModelCardProps {
  model: ModelInfo;
  isLoaded: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  onDownload: () => void;
  onDelete: () => void;
  onLoad: () => void;
}

function ModelCard({
  model,
  isLoaded,
  isDownloading,
  downloadProgress,
  onDownload,
  onDelete,
  onLoad,
}: ModelCardProps) {
  const sizeLabels: Record<ModelSize, string> = {
    tiny: "Fastest, basic accuracy",
    base: "Fast, good accuracy",
    small: "Balanced performance",
    medium: "Slower, high accuracy",
    large: "Slowest, best accuracy",
  };

  return (
    <div
      className="p-3 rounded-xl transition-colors"
      style={{
        backgroundColor: isLoaded ? "rgba(34, 197, 94, 0.06)" : "var(--color-bg-subtle)",
        border: isLoaded ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid transparent",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium" style={{ color: "var(--color-text)" }}>
              {model.name.charAt(0).toUpperCase() + model.name.slice(1)}
            </h3>
            {isLoaded && (
              <span
                className="px-1.5 py-0.5 text-xs font-medium rounded"
                style={{ backgroundColor: "rgba(34, 197, 94, 0.15)", color: "#16a34a" }}
              >
                Active
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
            {sizeLabels[model.size]} · {model.size_mb} MB
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {model.downloaded ? (
            <>
              {!isLoaded && (
                <button
                  onClick={onLoad}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  Load
                </button>
              )}
              <button
                onClick={onDelete}
                disabled={isLoaded}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  color: "#dc2626",
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={onDownload}
              disabled={isDownloading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-text)",
                color: "white",
              }}
            >
              {isDownloading ? `${downloadProgress}%` : "Download"}
            </button>
          )}
        </div>
      </div>

      {isDownloading && !model.downloaded && (
        <div
          className="mt-2 h-1 rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--color-border)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${downloadProgress}%`,
              backgroundColor: "var(--color-accent)",
            }}
          />
        </div>
      )}
    </div>
  );
}
