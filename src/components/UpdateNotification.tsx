import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useUpdater } from "../hooks";

interface UpdateNotificationProps {
  onOpenSettings: () => void;
}

export function UpdateNotification({ onOpenSettings }: UpdateNotificationProps) {
  const {
    available,
    version,
    downloading,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
  } = useUpdater();
  const [dismissed, setDismissed] = useState(false);

  // Check for updates on mount and periodically (every hour)
  useEffect(() => {
    // Initial check with a small delay to not block startup
    const initialTimer = setTimeout(() => {
      checkForUpdates();
    }, 3000);

    // Periodic check every hour
    const intervalTimer = setInterval(() => {
      checkForUpdates();
    }, 60 * 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [checkForUpdates]);

  // Emit update status to Rust for tray indicator
  useEffect(() => {
    emit("update-status-changed", { available, version: version || null });
  }, [available, version]);

  // Listen for tray install action
  useEffect(() => {
    const unlisten = listen("tray-install-update", () => {
      downloadAndInstall();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [downloadAndInstall]);

  if (!available || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    // Store state remains intact - other warnings stay visible
  };

  return (
    <div
      className="fixed bottom-20 right-4 z-50 max-w-sm rounded-xl p-4 shadow-lg"
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--color-accent-light)" }}
        >
          <svg
            className="w-4 h-4"
            style={{ color: "var(--color-accent)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text)" }}
          >
            Update Available
          </p>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Version {version} is ready to install
          </p>

          {downloading && (
            <div className="mt-2">
              <div
                className="h-1.5 rounded-full overflow-hidden"
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
            </div>
          )}

          {error && (
            <p className="text-xs mt-1" style={{ color: "#dc2626" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={downloadAndInstall}
              disabled={downloading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {downloading ? "Installing..." : "Install Now"}
            </button>
            <button
              onClick={onOpenSettings}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: "var(--color-sidebar)",
                color: "var(--color-text)",
              }}
            >
              Details
            </button>
            {!downloading && (
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{
                  color: "var(--color-text-secondary)",
                }}
              >
                Later
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
