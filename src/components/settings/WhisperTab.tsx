import { useModels } from "../../hooks";
import {
  useWhisperStore,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from "../../stores/whisperStore";
import type { ModelInfo, ModelSize } from "../../types";

export function WhisperTab() {
  const {
    models,
    loadedModel,
    isDownloading,
    downloadingModel,
    downloadProgress,
    error,
    downloadModel,
    deleteModel,
    loadModel,
  } = useModels();

  const language = useWhisperStore((state) => state.language);
  const setLanguage = useWhisperStore((state) => state.setLanguage);

  const sizeLabels: Record<ModelSize, string> = {
    tiny: "Fastest, basic accuracy",
    base: "Fast, good accuracy",
    small: "Balanced performance",
    medium: "Slower, high accuracy",
    large: "Slowest, best accuracy",
  };

  return (
    <div>
      {error && (
        <div
          className="mb-4 px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            color: "#dc2626",
          }}
        >
          {error}
        </div>
      )}

      {/* Language Selection */}
      <div className="mb-6">
        <h3
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Language
        </h3>
        <p
          className="text-sm mb-3"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Select the language for transcription.
        </p>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as WhisperLanguage)}
          className="w-full h-10 px-3 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
        >
          {WHISPER_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      {/* Model Selection */}
      <div>
        <h3
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Model
        </h3>
        <p
          className="text-sm mb-3"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Download a model for local transcription. Larger models are more
          accurate but slower.
        </p>

        <div className="space-y-2">
          {models.map((model) => (
            <WhisperModelCard
              key={model.size}
              model={model}
              isLoaded={loadedModel === model.size}
              isDownloading={isDownloading && downloadingModel === model.size}
              downloadProgress={downloadProgress}
              sizeLabel={sizeLabels[model.size]}
              isRecommended={model.size === "base"}
              onDownload={() => downloadModel(model.size)}
              onDelete={() => deleteModel(model.size)}
              onLoad={() => loadModel(model.size)}
              isAnyDownloading={isDownloading}
            />
          ))}
        </div>

        <p
          className="mt-4 text-xs"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {loadedModel ? `Active model: ${loadedModel}` : "No model loaded"}
        </p>
      </div>
    </div>
  );
}

interface WhisperModelCardProps {
  model: ModelInfo;
  isLoaded: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  sizeLabel: string;
  isRecommended: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onLoad: () => void;
  isAnyDownloading: boolean;
}

function WhisperModelCard({
  model,
  isLoaded,
  isDownloading,
  downloadProgress,
  sizeLabel,
  isRecommended,
  onDownload,
  onDelete,
  onLoad,
  isAnyDownloading,
}: WhisperModelCardProps) {
  return (
    <div
      className="p-3 rounded-xl transition-colors"
      style={{
        backgroundColor: isLoaded
          ? "rgba(34, 197, 94, 0.06)"
          : "var(--color-bg-subtle)",
        border: isLoaded
          ? "1px solid rgba(34, 197, 94, 0.2)"
          : "1px solid transparent",
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
                style={{
                  backgroundColor: "rgba(34, 197, 94, 0.15)",
                  color: "#16a34a",
                }}
              >
                Active
              </span>
            )}
            {isRecommended && (
              <span
                className="px-1.5 py-0.5 text-xs font-medium rounded"
                style={{
                  backgroundColor: "var(--color-accent-light)",
                  color: "var(--color-accent)",
                }}
              >
                Recommended
              </span>
            )}
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {sizeLabel} · {model.size_mb} MB
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
              disabled={isAnyDownloading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "#374151",
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
