import { useOllama } from "../../hooks";

export function OllamaTab() {
  const {
    loading,
    error,
    isRunning,
    models,
    selectedModel,
    selectModel,
    checkStatus,
  } = useOllama();

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  // Filter out embedding models (not useful for text generation)
  const isEmbeddingModel = (name: string) => {
    const lower = name.toLowerCase();
    return lower.includes("embed") || lower.includes("minilm");
  };
  const generativeModels = models.filter(
    (model) => !isEmbeddingModel(model.name)
  );

  // Model recommendations
  const getRecommendation = (modelName: string) => {
    const lower = modelName.toLowerCase();
    if (lower === "gemma3:latest" || lower === "gemma3") return "Recommended";
    if (lower === "gemma3:27b") return "High-end";
    if (lower === "gemma3:1b" || lower === "gemma3:1b-it") return "Lightweight";
    return null;
  };

  return (
    <div>
      {/* Status */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: isRunning ? "#22c55e" : "#ef4444" }}
            />
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text)" }}
            >
              Ollama {isRunning ? "Running" : "Not Running"}
            </span>
          </div>
          <button
            onClick={checkStatus}
            disabled={loading}
            className="text-sm transition-colors"
            style={{ color: "var(--color-accent)" }}
          >
            {loading ? "Checking..." : "Refresh"}
          </button>
        </div>

        {!isRunning && (
          <div
            className="mt-3 p-3 rounded-xl text-sm"
            style={{
              backgroundColor: "rgba(245, 158, 11, 0.08)",
              color: "#b45309",
            }}
          >
            <p className="font-medium mb-1">Ollama is not running</p>
            <p className="text-xs">
              Follow our{" "}
              <a
                href="https://note67.com/ollama-setup"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Ollama setup guide
              </a>{" "}
              to get started.
            </p>
          </div>
        )}
      </div>

      {/* Model Recommendations */}
      {isRunning && (
        <div
          className="mb-6 p-3 rounded-xl text-sm"
          style={{
            backgroundColor: "rgba(59, 130, 246, 0.08)",
            color: "var(--color-text-secondary)",
          }}
        >
          <p
            className="font-medium mb-2"
            style={{ color: "var(--color-text)" }}
          >
            Recommended Models
          </p>
          <ul className="space-y-1 text-xs">
            <li>
              <strong>gemma3:latest</strong> — Best for most users
            </li>
            <li>
              <strong>gemma3:1b</strong> — Lightweight, for older computers
            </li>
            <li>
              <strong>gemma3:27b</strong> — High quality, for newer computers
              with GPU
            </li>
          </ul>
        </div>
      )}

      {/* Error */}
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

      {/* Models List */}
      {isRunning && (
        <div>
          <h3
            className="text-sm font-medium mb-3"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Available Models
          </h3>

          {generativeModels.length === 0 ? (
            <div
              className="p-4 rounded-xl text-center"
              style={{ backgroundColor: "var(--color-bg-subtle)" }}
            >
              <p
                className="text-sm mb-2"
                style={{ color: "var(--color-text-secondary)" }}
              >
                No models found
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Follow our{" "}
                <a
                  href="https://note67.com/ollama-setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                  style={{ color: "var(--color-accent)" }}
                >
                  setup guide
                </a>{" "}
                to download a model.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {generativeModels.map((model) => (
                <button
                  key={model.name}
                  onClick={() => selectModel(model.name)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
                  style={{
                    backgroundColor:
                      selectedModel === model.name
                        ? "rgba(59, 130, 246, 0.06)"
                        : "var(--color-bg-subtle)",
                    border:
                      selectedModel === model.name
                        ? "1px solid rgba(59, 130, 246, 0.2)"
                        : "1px solid transparent",
                  }}
                >
                  {/* Radio indicator */}
                  <span
                    className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center"
                    style={{
                      border:
                        selectedModel === model.name
                          ? "none"
                          : "2px solid var(--color-border)",
                      backgroundColor:
                        selectedModel === model.name
                          ? "var(--color-accent)"
                          : "transparent",
                    }}
                  >
                    {selectedModel === model.name && (
                      <svg
                        className="w-2.5 h-2.5 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className="font-medium truncate"
                        style={{ color: "var(--color-text)" }}
                      >
                        {model.name}
                      </p>
                      {getRecommendation(model.name) && (
                        <span
                          className="px-1.5 py-0.5 text-xs font-medium rounded shrink-0"
                          style={{
                            backgroundColor:
                              getRecommendation(model.name) === "Recommended"
                                ? "rgba(34, 197, 94, 0.15)"
                                : "var(--color-accent-light)",
                            color:
                              getRecommendation(model.name) === "Recommended"
                                ? "#16a34a"
                                : "var(--color-accent)",
                          }}
                        >
                          {getRecommendation(model.name)}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      {formatSize(model.size)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
