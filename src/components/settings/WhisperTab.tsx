import { useModels } from "../../hooks";
import {
  languageName,
  modelSupportsLanguage,
  useWhisperStore,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from "../../stores/whisperStore";
import type { ModelInfo, ModelSize } from "../../types";

/// What a model's language coverage amounts to, for the card's summary line.
function coverageLabel(model: ModelInfo): string {
  return model.languages === null
    ? "99 languages"
    : `${model.languages.length} European languages`;
}

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
    "tiny-q8": "Fastest, basic accuracy (quantized)",
    base: "Fast, good accuracy",
    "base-q8": "Fast, good accuracy (quantized)",
    small: "Balanced performance",
    "small-q8": "Balanced, smaller download",
    medium: "Slower, high accuracy",
    "medium-q8": "High accuracy, smaller download",
    large: "Best accuracy, slowest",
    "large-turbo": "Fast + accurate, full size",
    "large-turbo-q8": "Fast + accurate, half the size (recommended)",
    "parakeet-ultra": "Much faster, fewer languages",
  };

  // The model that is loaded right now, if the list has caught up with it.
  const activeModel = models.find((m) => m.size === loadedModel);
  // Changing the language after loading a model can leave the two at odds.
  // Nothing downstream can paper over that: Parakeet has no Chinese to fall
  // back on, so say it here rather than letting a recording fail later.
  const activeModelMismatch =
    activeModel && !modelSupportsLanguage(activeModel, language)
      ? activeModel
      : null;

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

      {activeModelMismatch && (
        <div
          className="mb-4 px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.1)",
            color: "#b45309",
          }}
        >
          The active model, {activeModelMismatch.name}, can&rsquo;t transcribe{" "}
          {languageName(language)} — it only covers{" "}
          {coverageLabel(activeModelMismatch)}. Load a Whisper model below to
          transcribe {languageName(language)}, or change the language.
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
          Select the language for transcription. Whisper models cover all of
          these; Parakeet covers the European ones only, and each model below
          says what it can do.
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
              isRecommended={model.size === "large-turbo-q8"}
              language={language}
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
  /** The chosen transcription language, to say up front whether this model can
   * actually write it. */
  language: WhisperLanguage;
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
  language,
  onDownload,
  onDelete,
  onLoad,
  isAnyDownloading,
}: WhisperModelCardProps) {
  const supportsLanguage = modelSupportsLanguage(model, language);

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
            {model.engine === "parakeet" && (
              <span
                className="px-1.5 py-0.5 text-xs font-medium rounded"
                style={{
                  backgroundColor: "rgba(59, 130, 246, 0.12)",
                  color: "#2563eb",
                }}
              >
                Faster
              </span>
            )}
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {sizeLabel} · {model.size_mb} MB · {coverageLabel(model)}
          </p>
          {!supportsLanguage && (
            <p className="text-xs mt-1" style={{ color: "#b45309" }}>
              Can&rsquo;t transcribe {languageName(language)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {model.downloaded ? (
            <>
              {!isLoaded && (
                <button
                  onClick={onLoad}
                  disabled={!supportsLanguage}
                  title={
                    supportsLanguage
                      ? undefined
                      : `This model can't transcribe ${languageName(language)}`
                  }
                  className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
