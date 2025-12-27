import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SystemTab() {
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [systemAudioSupported, setSystemAudioSupported] = useState(false);
  const [systemAudioPermission, setSystemAudioPermission] = useState(false);
  const [systemAudioLoading, setSystemAudioLoading] = useState(true);
  const [requestingPermission, setRequestingPermission] = useState(false);

  useEffect(() => {
    invoke<boolean>("get_autostart_enabled")
      .then((enabled) => {
        setAutostart(enabled);
        setAutostartLoading(false);
      })
      .catch((err) => {
        console.error("Failed to get autostart status:", err);
        setAutostartLoading(false);
      });

    // Check system audio support and permission
    invoke<boolean>("is_system_audio_supported")
      .then((supported) => {
        setSystemAudioSupported(supported);
        if (supported) {
          return invoke<boolean>("has_system_audio_permission");
        }
        return false;
      })
      .then((hasPermission) => {
        setSystemAudioPermission(hasPermission);
        setSystemAudioLoading(false);
      })
      .catch((err) => {
        console.error("Failed to check system audio:", err);
        setSystemAudioLoading(false);
      });
  }, []);

  const handleAutostartChange = async (enabled: boolean) => {
    try {
      await invoke("set_autostart_enabled", { enabled });
      setAutostart(enabled);
    } catch (err) {
      console.error("Failed to set autostart:", err);
    }
  };

  const handleOpenSystemSettings = async () => {
    try {
      await invoke("open_screen_recording_settings");
    } catch (err) {
      console.error("Failed to open Screen Recording settings:", err);
    }
  };

  const handleCheckPermission = async () => {
    setRequestingPermission(true);
    try {
      const granted = await invoke<boolean>("has_system_audio_permission");
      setSystemAudioPermission(granted);
    } catch (err) {
      console.error("Failed to check permission:", err);
    } finally {
      setRequestingPermission(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Startup Section */}
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Startup
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Configure how Note67 starts up.
        </p>
      </div>

      <button
        onClick={() => handleAutostartChange(!autostart)}
        disabled={autostartLoading}
        className="w-full flex items-center justify-between p-3 rounded-xl transition-colors"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: autostart
                ? "var(--color-accent-light)"
                : "var(--color-bg-elevated)",
              color: autostart
                ? "var(--color-accent)"
                : "var(--color-text-secondary)",
            }}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
          </span>
          <div className="text-left">
            <p className="font-medium" style={{ color: "var(--color-text)" }}>
              Launch at login
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Start Note67 automatically when you log in
            </p>
          </div>
        </div>
        <div
          className="w-11 h-6 rounded-full transition-colors relative"
          style={{
            backgroundColor: autostart
              ? "var(--color-accent)"
              : "var(--color-border)",
          }}
        >
          <div
            className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform"
            style={{
              transform: autostart ? "translateX(22px)" : "translateX(2px)",
            }}
          />
        </div>
      </button>

      {/* System Audio Section (macOS only) */}
      {systemAudioSupported && (
        <>
          <div className="pt-4">
            <h3
              className="text-sm font-semibold mb-3"
              style={{ color: "var(--color-text)" }}
            >
              System Audio
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Capture audio from other participants via system audio.
            </p>
          </div>

          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: systemAudioPermission
                      ? "rgba(34, 197, 94, 0.15)"
                      : "var(--color-bg-elevated)",
                    color: systemAudioPermission
                      ? "#22c55e"
                      : "var(--color-text-secondary)",
                  }}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                  </svg>
                </span>
                <div>
                  <p
                    className="font-medium"
                    style={{ color: "var(--color-text)" }}
                  >
                    Screen Recording Permission
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    {systemAudioLoading
                      ? "Checking..."
                      : systemAudioPermission
                        ? "Granted - System audio capture enabled"
                        : "Required to capture other participants' audio"}
                  </p>
                </div>
              </div>
              {!systemAudioLoading && !systemAudioPermission && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCheckPermission}
                    disabled={requestingPermission}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--color-bg-elevated)",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {requestingPermission ? "Checking..." : "Refresh"}
                  </button>
                  <button
                    onClick={handleOpenSystemSettings}
                    className="px-4 py-1.5 text-sm font-medium rounded-lg transition-colors"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    Open Settings
                  </button>
                </div>
              )}
              {!systemAudioLoading && systemAudioPermission && (
                <span
                  className="px-3 py-1.5 text-xs font-medium rounded-lg"
                  style={{
                    backgroundColor: "rgba(34, 197, 94, 0.15)",
                    color: "#16a34a",
                  }}
                >
                  Enabled
                </span>
              )}
            </div>

            {!systemAudioPermission && !systemAudioLoading && (
              <div
                className="mt-3 p-3 rounded-lg text-xs"
                style={{
                  backgroundColor: "rgba(59, 130, 246, 0.08)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <p className="mb-2">
                  <strong>How to enable:</strong>
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Click "Open Settings" to open System Settings</li>
                  <li>Find Note67 in the list and toggle it on</li>
                  <li>Restart Note67 if prompted</li>
                  <li>Click "Refresh" to verify permission</li>
                </ol>
                <p
                  className="mt-2"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  This allows Note67 to capture system audio to distinguish your
                  voice from other participants.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        System settings are stored locally on this device.
      </p>
    </div>
  );
}
