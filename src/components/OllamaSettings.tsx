import { useOllama } from "../hooks";

interface OllamaSettingsProps {
  onClose: () => void;
}

export function OllamaSettings({ onClose }: OllamaSettingsProps) {
  const { loading, error, isRunning, models, selectedModel, selectModel, checkStatus } =
    useOllama();

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            AI Settings (Ollama)
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {/* Status */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  isRunning ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Ollama Status: {isRunning ? "Running" : "Not Running"}
              </span>
              <button
                onClick={checkStatus}
                disabled={loading}
                className="ml-auto text-sm text-blue-500 hover:text-blue-600"
              >
                {loading ? "Checking..." : "Refresh"}
              </button>
            </div>

            {!isRunning && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Ollama is not running. Please start Ollama first:
                </p>
                <ol className="mt-2 text-sm text-yellow-700 dark:text-yellow-300 list-decimal list-inside space-y-1">
                  <li>
                    Install Ollama from{" "}
                    <a
                      href="https://ollama.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      ollama.ai
                    </a>
                  </li>
                  <li>
                    Run <code className="px-1 bg-yellow-100 dark:bg-yellow-800 rounded">ollama serve</code>{" "}
                    in terminal
                  </li>
                  <li>
                    Pull a model:{" "}
                    <code className="px-1 bg-yellow-100 dark:bg-yellow-800 rounded">
                      ollama pull llama3.2
                    </code>
                  </li>
                </ol>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Models List */}
          {isRunning && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Available Models
              </h3>

              {models.length === 0 ? (
                <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No models found. Pull a model using:
                  </p>
                  <code className="block mt-2 text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded">
                    ollama pull llama3.2
                  </code>
                </div>
              ) : (
                <div className="space-y-2">
                  {models.map((model) => (
                    <div
                      key={model.name}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedModel === model.name
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                      onClick={() => selectModel(model.name)}
                    >
                      <div className="flex items-center gap-3">
                        {selectedModel === model.name && (
                          <svg
                            className="w-5 h-5 text-indigo-500"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {model.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatSize(model.size)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
