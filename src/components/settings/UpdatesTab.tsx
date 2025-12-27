import { useState } from "react";
import { useUpdater } from "../../hooks";
import { APP_VERSION } from "./constants";

export function UpdatesTab() {
  const {
    checking,
    available,
    version,
    body,
    downloading,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
  } = useUpdater();
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const handleCheckUpdates = async () => {
    await checkForUpdates();
    setLastChecked(new Date().toLocaleTimeString());
  };

  const recentChanges = [
    {
      version: "0.1.0",
      date: "December 2025",
      changes: [
        "Initial release",
        "Local Whisper transcription",
        "Ollama integration for AI summaries",
        "Note management and organization",
        "Export to Markdown",
        "Privacy-focused design",
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Current Version */}
      <div
        className="p-4 rounded-xl flex items-center justify-between"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text)" }}
          >
            Current Version
          </p>
          <p
            className="text-2xl font-bold mt-1"
            style={{ color: "var(--color-accent)" }}
          >
            {APP_VERSION}
          </p>
        </div>
        <button
          onClick={handleCheckUpdates}
          disabled={checking}
          className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
          }}
        >
          {checking ? "Checking..." : "Check for Updates"}
        </button>
      </div>

      {/* Update Available */}
      {available && version && (
        <div
          className="p-4 rounded-xl"
          style={{
            backgroundColor: "var(--color-accent-light)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p
              className="text-sm font-medium"
              style={{ color: "var(--color-text)" }}
            >
              Update Available: v{version}
            </p>
            <button
              onClick={downloadAndInstall}
              disabled={downloading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {downloading ? "Installing..." : "Install Update"}
            </button>
          </div>
          {body && (
            <p
              className="text-xs mt-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {body}
            </p>
          )}
          {downloading && (
            <div className="mt-3">
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: "var(--color-accent)",
                  }}
                />
              </div>
              <p
                className="text-xs mt-1 text-right"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {progress}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div
          className="p-3 rounded-lg text-sm"
          style={{
            backgroundColor: "#fef2f2",
            color: "#dc2626",
            border: "1px solid #fecaca",
          }}
        >
          {error}
        </div>
      )}

      {lastChecked && !available && (
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          Last checked: {lastChecked} — You're up to date!
        </p>
      )}

      {/* Recent Changes */}
      <div>
        <h3
          className="text-sm font-medium mb-3"
          style={{ color: "var(--color-text)" }}
        >
          What's New
        </h3>
        <div className="space-y-4">
          {recentChanges.map((release) => (
            <div
              key={release.version}
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--color-bg-subtle)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="px-2 py-0.5 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--color-accent-light)",
                    color: "var(--color-accent)",
                  }}
                >
                  v{release.version}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {release.date}
                </span>
              </div>
              <ul className="space-y-1.5">
                {release.changes.map((change, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-sm"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    <svg
                      className="w-4 h-4 shrink-0 mt-0.5"
                      style={{ color: "#22c55e" }}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-update info */}
      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Updates are downloaded and installed automatically when available.
      </p>
    </div>
  );
}
