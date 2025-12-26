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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Whisper Models
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg text-sm">
              {error}
            </div>
          )}

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Download a Whisper model for local transcription. Larger models are more accurate but require more memory and time.
          </p>

          <div className="space-y-3">
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

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Models are stored locally. {loadedModel ? `Current model: ${loadedModel}` : "No model loaded."}
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
    tiny: "Tiny - Fastest, least accurate",
    base: "Base - Fast, good accuracy",
    small: "Small - Balanced",
    medium: "Medium - Slower, high accuracy",
    large: "Large - Slowest, best accuracy",
  };

  return (
    <div
      className={`p-3 rounded-lg border ${
        isLoaded
          ? "border-green-500 bg-green-50 dark:bg-green-900/20"
          : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
            {model.name.charAt(0).toUpperCase() + model.name.slice(1)}
            {isLoaded && (
              <span className="px-2 py-0.5 text-xs bg-green-500 text-white rounded-full">
                Loaded
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {sizeLabels[model.size]} ({model.size_mb} MB)
          </p>
        </div>
        <div className="flex gap-2">
          {model.downloaded ? (
            <>
              {!isLoaded && (
                <button
                  onClick={onLoad}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Load
                </button>
              )}
              <button
                onClick={onDelete}
                disabled={isLoaded}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={onDownload}
              disabled={isDownloading}
              className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              {isDownloading ? `${downloadProgress}%` : "Download"}
            </button>
          )}
        </div>
      </div>

      {isDownloading && !model.downloaded && (
        <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}
