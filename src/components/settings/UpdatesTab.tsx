import { useState } from "react";
import { APP_VERSION } from "./constants";

export function UpdatesTab() {
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const handleCheckUpdates = async () => {
    setChecking(true);
    // Simulate checking for updates
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setChecking(false);
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

      {lastChecked && (
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
