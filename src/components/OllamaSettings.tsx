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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            AI Settings
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
        <div className="p-5 overflow-y-auto" style={{ maxHeight: "60vh" }}>
          {/* Status */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: isRunning ? "#22c55e" : "#ef4444" }}
                />
                <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
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
                <p className="font-medium mb-2">Start Ollama first:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>
                    Install from{" "}
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
                    Run <code className="px-1 py-0.5 rounded" style={{ backgroundColor: "rgba(245, 158, 11, 0.15)" }}>ollama serve</code>
                  </li>
                  <li>
                    Pull a model: <code className="px-1 py-0.5 rounded" style={{ backgroundColor: "rgba(245, 158, 11, 0.15)" }}>ollama pull llama3.2</code>
                  </li>
                </ol>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-4 px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", color: "#dc2626" }}
            >
              {error}
            </div>
          )}

          {/* Models List */}
          {isRunning && (
            <div>
              <h3 className="text-sm font-medium mb-3" style={{ color: "var(--color-text-secondary)" }}>
                Available Models
              </h3>

              {models.length === 0 ? (
                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: "var(--color-bg-subtle)" }}
                >
                  <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
                    No models found
                  </p>
                  <code className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                    ollama pull llama3.2
                  </code>
                </div>
              ) : (
                <div className="space-y-2">
                  {models.map((model) => (
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
                          border: selectedModel === model.name
                            ? "none"
                            : "2px solid var(--color-border)",
                          backgroundColor: selectedModel === model.name ? "var(--color-accent)" : "transparent",
                        }}
                      >
                        {selectedModel === model.name && (
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate" style={{ color: "var(--color-text)" }}>
                          {model.name}
                        </p>
                        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
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

        {/* Footer */}
        <div
          className="flex justify-end px-5 py-4"
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              backgroundColor: "var(--color-bg-subtle)",
              color: "var(--color-text-secondary)",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
