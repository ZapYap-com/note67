import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SystemTab() {
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [systemAudioSupported, setSystemAudioSupported] = useState(false);
  const [systemAudioPermission, setSystemAudioPermission] = useState(false);
  const [systemAudioLoading, setSystemAudioLoading] = useState(true);
  const [requestingPermission, setRequestingPermission] = useState(false);
  // Microphone state
  const [micAvailable, setMicAvailable] = useState(false);
  const [micPermission, setMicPermission] = useState(false);
  const [micAuthStatus, setMicAuthStatus] = useState<number>(0); // 0=NotDetermined, 1=Restricted, 2=Denied, 3=Authorized
  const [micLoading, setMicLoading] = useState(true);
  const [refreshingMic, setRefreshingMic] = useState(false);

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

    // Check microphone availability and permission
    Promise.all([
      invoke<boolean>("has_microphone_available"),
      invoke<boolean>("has_microphone_permission"),
      invoke<number>("get_microphone_auth_status"),
    ])
      .then(([available, permission, status]) => {
        setMicAvailable(available);
        setMicPermission(permission);
        setMicAuthStatus(status);
        setMicLoading(false);
      })
      .catch((err) => {
        console.error("Failed to check microphone:", err);
        setMicLoading(false);
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

  const handleOpenMicSettings = async () => {
    try {
      await invoke("open_microphone_settings");
    } catch (err) {
      console.error("Failed to open Microphone settings:", err);
    }
  };

  const handleCheckMicPermission = async () => {
    setRefreshingMic(true);
    try {
      const [available, permission, status] = await Promise.all([
        invoke<boolean>("has_microphone_available"),
        invoke<boolean>("has_microphone_permission"),
        invoke<number>("get_microphone_auth_status"),
      ]);
      setMicAvailable(available);
      setMicPermission(permission);
      setMicAuthStatus(status);
    } catch (err) {
      console.error("Failed to check microphone:", err);
    } finally {
      setRefreshingMic(false);
    }
  };

  const handleRequestMicPermission = async () => {
    setRefreshingMic(true);
    try {
      // This will trigger the macOS permission dialog
      const granted = await invoke<boolean>("request_microphone_permission");
      setMicPermission(granted);
      if (granted) {
        setMicAuthStatus(3); // Authorized
      } else {
        // Refresh to get the actual status (could be denied or still not determined)
        const status = await invoke<number>("get_microphone_auth_status");
        setMicAuthStatus(status);
      }
    } catch (err) {
      console.error("Failed to request microphone permission:", err);
    } finally {
      setRefreshingMic(false);
    }
  };

  const getMicStatusText = () => {
    if (micLoading) return "Checking...";
    if (!micAvailable) return "No microphone detected";
    if (micAuthStatus === 0) return "Permission not requested yet";
    if (micAuthStatus === 1) return "Restricted by system policy";
    if (micAuthStatus === 2) return "Permission denied";
    if (micAuthStatus === 3) return "Granted - Microphone enabled";
    return "Unknown status";
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

      {/* Microphone Section */}
      <div className="pt-4">
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Microphone
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Capture your voice during recordings.
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
                backgroundColor:
                  micAvailable && micPermission
                    ? "rgba(34, 197, 94, 0.15)"
                    : !micAvailable
                      ? "rgba(239, 68, 68, 0.15)"
                      : "var(--color-bg-elevated)",
                color:
                  micAvailable && micPermission
                    ? "#22c55e"
                    : !micAvailable
                      ? "#ef4444"
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
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </span>
            <div>
              <p
                className="font-medium"
                style={{ color: "var(--color-text)" }}
              >
                Microphone Access
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {getMicStatusText()}
              </p>
            </div>
          </div>
          {!micLoading && (!micAvailable || !micPermission) && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckMicPermission}
                disabled={refreshingMic}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {refreshingMic ? "Checking..." : "Refresh"}
              </button>
              {micAvailable && micAuthStatus === 0 ? (
                <button
                  onClick={handleRequestMicPermission}
                  disabled={refreshingMic}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  Request Permission
                </button>
              ) : (
                <button
                  onClick={handleOpenMicSettings}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  Open Settings
                </button>
              )}
            </div>
          )}
          {!micLoading && micAvailable && micPermission && (
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

        {!micLoading && !micAvailable && (
          <div
            className="mt-3 p-3 rounded-lg text-xs"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.08)",
              color: "var(--color-text-secondary)",
            }}
          >
            <p>
              <strong>No microphone detected.</strong> Connect an external
              microphone or headset to record your voice.
            </p>
          </div>
        )}

        {!micLoading && micAvailable && !micPermission && (
          <div
            className="mt-3 p-3 rounded-lg text-xs"
            style={{
              backgroundColor: "rgba(59, 130, 246, 0.08)",
              color: "var(--color-text-secondary)",
            }}
          >
            {micAuthStatus === 0 ? (
              <p>
                Click <strong>"Request Permission"</strong> to allow Note67 to
                access your microphone. A system dialog will appear.
              </p>
            ) : (
              <>
                <p className="mb-2">
                  <strong>How to enable:</strong>
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Click "Open Settings" to open System Settings</li>
                  <li>Find Note67 in the Microphone list and toggle it on</li>
                  <li>Click "Refresh" to verify permission</li>
                </ol>
              </>
            )}
          </div>
        )}
      </div>

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
