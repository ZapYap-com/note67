import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useModels, useOllama } from "../hooks";
import { useProfileStore } from "../stores/profileStore";
import { useThemeStore } from "../stores/themeStore";
import type { ModelInfo, ModelSize } from "../types";

export type { UserProfile } from "../stores/profileStore";

export function useProfile() {
  const profile = useProfileStore((state) => state.profile);
  const updateProfile = useProfileStore((state) => state.updateProfile);
  return { profile, updateProfile };
}

type SettingsTab =
  | "profile"
  | "appearance"
  | "whisper"
  | "ollama"
  | "privacy"
  | "shortcuts"
  | "about"
  | "updates";

interface SettingsProps {
  onClose: () => void;
  initialTab?: SettingsTab;
}

const WarningIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    style={{ color: "#f59e0b" }}
    fill="currentColor"
    viewBox="0 0 20 20"
  >
    <path
      fillRule="evenodd"
      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
      clipRule="evenodd"
    />
  </svg>
);

export function Settings({ onClose, initialTab = "profile" }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const { profile } = useProfile();
  const { loadedModel } = useModels();
  const { isRunning: ollamaRunning, selectedModel: ollamaModel } = useOllama();

  // Check if each setting needs attention
  const profileNeedsSetup = !profile.name;
  const whisperNeedsSetup = !loadedModel;
  const ollamaNeedsSetup = !ollamaRunning || !ollamaModel;

  const tabs: {
    id: SettingsTab;
    label: string;
    icon: React.ReactNode;
    warning: boolean;
  }[] = [
    {
      id: "profile",
      label: "Profile",
      warning: profileNeedsSetup,
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
    {
      id: "appearance",
      label: "Appearance",
      warning: false,
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
    {
      id: "whisper",
      label: "Whisper",
      warning: whisperNeedsSetup,
      icon: (
        <svg
          className="w-4 h-4"
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
      ),
    },
    {
      id: "ollama",
      label: "Ollama",
      warning: ollamaNeedsSetup,
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
      ),
    },
    {
      id: "privacy",
      label: "Best Practices",
      warning: false,
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
      ),
    },
    {
      id: "shortcuts",
      label: "Shortcuts",
      warning: false,
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      ),
    },
    {
      id: "about",
      label: "About",
      warning: false,
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      id: "updates",
      label: "Updates",
      warning: false,
      icon: (
        <svg
          className="w-4 h-4"
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
      ),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-4xl rounded-2xl overflow-hidden flex"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
          height: "600px",
        }}
      >
        {/* Left Sidebar - Tabs */}
        <div
          className="w-48 shrink-0 flex flex-col"
          style={{
            backgroundColor: "var(--color-sidebar)",
            borderRight: "1px solid var(--color-border)",
          }}
        >
          <div className="p-4">
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text)" }}
            >
              Settings
            </h2>
          </div>
          <nav className="flex-1 px-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm font-medium transition-colors mb-1"
                style={{
                  backgroundColor:
                    activeTab === tab.id
                      ? "var(--color-sidebar-selected)"
                      : "transparent",
                  color:
                    activeTab === tab.id
                      ? "var(--color-text)"
                      : "var(--color-text-secondary)",
                }}
              >
                {tab.icon}
                <span className="flex-1">{tab.label}</span>
                {tab.warning && <WarningIcon />}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4 shrink-0"
            style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
          >
            <h3
              className="text-base font-medium"
              style={{ color: "var(--color-text)" }}
            >
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-1 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: "var(--color-text-tertiary)" }}
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "whisper" && <WhisperTab />}
            {activeTab === "ollama" && <OllamaTab />}
            {activeTab === "privacy" && <PrivacyTab />}
            {activeTab === "shortcuts" && <ShortcutsTab />}
            {activeTab === "about" && <AboutTab />}
            {activeTab === "updates" && <UpdatesTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  const { profile, updateProfile } = useProfile();
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(profile.name);
    setEmail(profile.email);
    setAvatar(profile.avatar);
  }, [profile]);

  const hasChanges =
    name !== profile.name ||
    email !== profile.email ||
    avatar !== profile.avatar;

  const handleSave = () => {
    updateProfile({ name, email, avatar });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const avatarOptions = ["😊", "🎯", "💼", "🎨", "🚀", "💡", "🎵", "📚"];

  return (
    <div className="space-y-6">
      <div>
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Avatar
        </label>
        <div className="flex gap-2 flex-wrap">
          {avatarOptions.map((emoji) => (
            <button
              key={emoji}
              onClick={() => setAvatar(emoji)}
              className="w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all"
              style={{
                backgroundColor:
                  avatar === emoji
                    ? "var(--color-accent-light)"
                    : "var(--color-bg-subtle)",
                border:
                  avatar === emoji
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
        />
      </div>

      <div>
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          Your profile is stored locally on this device.
        </p>
        <button
          onClick={handleSave}
          disabled={!hasChanges}
          className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
          style={{
            backgroundColor: saved ? "#22c55e" : "var(--color-accent)",
            color: "white",
          }}
        >
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useThemeStore();
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);

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
  }, []);

  const handleAutostartChange = async (enabled: boolean) => {
    try {
      await invoke("set_autostart_enabled", { enabled });
      setAutostart(enabled);
    } catch (err) {
      console.error("Failed to set autostart:", err);
    }
  };

  const themeOptions: {
    value: "light" | "dark" | "system";
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "light",
      label: "Light",
      description: "Always use light mode",
      icon: (
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
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
    },
    {
      value: "dark",
      label: "Dark",
      description: "Always use dark mode",
      icon: (
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
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
    {
      value: "system",
      label: "System",
      description: "Match your system settings",
      icon: (
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
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Theme
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Choose how Note67 looks to you.
        </p>
      </div>

      <div className="space-y-2">
        {themeOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
            style={{
              backgroundColor:
                theme === option.value
                  ? "rgba(59, 130, 246, 0.06)"
                  : "var(--color-bg-subtle)",
              border:
                theme === option.value
                  ? "1px solid rgba(59, 130, 246, 0.2)"
                  : "1px solid transparent",
            }}
          >
            <span
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor:
                  theme === option.value
                    ? "var(--color-accent-light)"
                    : "var(--color-bg-elevated)",
                color:
                  theme === option.value
                    ? "var(--color-accent)"
                    : "var(--color-text-secondary)",
              }}
            >
              {option.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p
                className="font-medium"
                style={{ color: "var(--color-text)" }}
              >
                {option.label}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {option.description}
              </p>
            </div>
            {theme === option.value && (
              <svg
                className="w-5 h-5 shrink-0"
                style={{ color: "var(--color-accent)" }}
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
          </button>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Your theme preference is stored locally on this device.
      </p>

      {/* Startup Section */}
      <div className="pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Startup
        </h3>
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
              <p
                className="font-medium"
                style={{ color: "var(--color-text)" }}
              >
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
              backgroundColor: autostart ? "var(--color-accent)" : "var(--color-border)",
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
      </div>
    </div>
  );
}

function WhisperTab() {
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

  const sizeLabels: Record<ModelSize, string> = {
    tiny: "Fastest, basic accuracy",
    base: "Fast, good accuracy",
    small: "Balanced performance",
    medium: "Slower, high accuracy",
    large: "Slowest, best accuracy",
  };

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

      <p
        className="text-sm mb-4"
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
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            sizeLabel={sizeLabels[model.size]}
            onDownload={() => downloadModel(model.size)}
            onDelete={() => deleteModel(model.size)}
            onLoad={() => loadModel(model.size)}
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
  );
}

interface WhisperModelCardProps {
  model: ModelInfo;
  isLoaded: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  sizeLabel: string;
  onDownload: () => void;
  onDelete: () => void;
  onLoad: () => void;
}

function WhisperModelCard({
  model,
  isLoaded,
  isDownloading,
  downloadProgress,
  sizeLabel,
  onDownload,
  onDelete,
  onLoad,
}: WhisperModelCardProps) {
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
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {sizeLabel} · {model.size_mb} MB
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {model.downloaded ? (
            <>
              {!isLoaded && (
                <button
                  onClick={onLoad}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
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
              disabled={isDownloading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-text)",
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

function PrivacyTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Best Practices for Recording
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          When recording meetings with other participants, follow these
          guidelines to ensure ethical and legal use.
        </p>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#22c55e" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Always Get Consent
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Inform all participants before recording begins. Get explicit
              verbal or written consent. Some jurisdictions require all-party
              consent.
            </p>
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#3b82f6" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              State the Purpose
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Clearly explain why you're recording and how the recording will be
              used. Mention if AI transcription or summarization will be
              applied.
            </p>
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#f59e0b" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Secure Your Data
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              All recordings and transcripts are stored locally on your device.
              Delete recordings when no longer needed.
            </p>
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#8b5cf6" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Know the Law
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Recording laws vary by location. Some regions require one-party
              consent, others require all-party consent. Check local
              regulations.
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Note67 processes everything locally. No audio or transcripts are sent to
        external servers.
      </p>
    </div>
  );
}

function ShortcutsTab() {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  const shortcuts = [
    { keys: [modKey, "N"], description: "Create new note" },
    { keys: [modKey, "R"], description: "Create new note and start recording" },
    { keys: [modKey, "M"], description: "Toggle light/dark mode" },
    { keys: [modKey, ","], description: "Open settings" },
    { keys: ["Esc"], description: "Close modals" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Keyboard Shortcuts
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Use these shortcuts to quickly navigate and control Note67.
        </p>
      </div>

      <div className="space-y-2">
        {shortcuts.map((shortcut, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 rounded-xl"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
          >
            <span
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {shortcut.description}
            </span>
            <div className="flex items-center gap-1">
              {shortcut.keys.map((key, keyIndex) => (
                <kbd
                  key={keyIndex}
                  className="px-2 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                  }}
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const APP_VERSION = "0.1.0";

function AboutTab() {
  return (
    <div className="space-y-6">
      {/* Logo and App Name */}
      <div className="text-center pb-4">
        <svg
          className="w-20 h-20 mx-auto mb-4"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="2"
            y="4"
            width="44"
            height="40"
            rx="10"
            fill="var(--color-accent)"
          />
          <path
            d="M12 12h18l6 6v18a1.5 1.5 0 01-1.5 1.5h-21A1.5 1.5 0 0112 36V13.5A1.5 1.5 0 0113.5 12z"
            fill="white"
            fillOpacity="0.95"
          />
          <path
            d="M30 12v5a1 1 0 001 1h5l-6-6z"
            fill="white"
            fillOpacity="0.6"
          />
          <rect
            x="16"
            y="24"
            width="2"
            height="8"
            rx="1"
            fill="var(--color-accent)"
          />
          <rect
            x="21"
            y="20"
            width="2"
            height="16"
            rx="1"
            fill="var(--color-accent)"
          />
          <rect
            x="26"
            y="22"
            width="2"
            height="12"
            rx="1"
            fill="var(--color-accent)"
          />
          <rect
            x="31"
            y="18"
            width="2"
            height="18"
            rx="1"
            fill="var(--color-accent)"
          />
        </svg>
        <h2
          className="text-2xl font-bold"
          style={{ color: "var(--color-text)" }}
        >
          Note<span style={{ color: "var(--color-accent)" }}>67</span>
        </h2>
        <p
          className="text-sm mt-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Version {APP_VERSION}
        </p>
      </div>

      {/* Description */}
      <div
        className="p-4 rounded-xl text-center"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-text)" }}>
          A privacy-focused meeting notes app with local AI transcription and
          summarization.
        </p>
      </div>

      {/* Privacy Commitment */}
      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "rgba(34, 197, 94, 0.06)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#22c55e" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Privacy First
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              All processing happens locally on your device. Your recordings,
              transcripts, and notes never leave your computer. No cloud, no
              tracking, no compromises.
            </p>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="space-y-2">
        <h4
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Features
        </h4>
        <ul
          className="space-y-1.5 text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            Local speech-to-text with Whisper
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            AI summaries powered by Ollama
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            Export to Markdown
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            100% offline capable
          </li>
        </ul>
      </div>

      {/* Credits */}
      <p
        className="text-xs text-center"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Built with Tauri, React, and Rust
      </p>
    </div>
  );
}

function UpdatesTab() {
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
        "Meeting management with notes",
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

function OllamaTab() {
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
                Run{" "}
                <code
                  className="px-1 py-0.5 rounded"
                  style={{ backgroundColor: "rgba(245, 158, 11, 0.15)" }}
                >
                  ollama serve
                </code>
              </li>
              <li>
                Pull a model:{" "}
                <code
                  className="px-1 py-0.5 rounded"
                  style={{ backgroundColor: "rgba(245, 158, 11, 0.15)" }}
                >
                  ollama pull llama3.2
                </code>
              </li>
            </ol>
          </div>
        )}
      </div>

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

          {models.length === 0 ? (
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
              <code
                className="text-xs"
                style={{ color: "var(--color-text-tertiary)" }}
              >
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
                    <p
                      className="font-medium truncate"
                      style={{ color: "var(--color-text)" }}
                    >
                      {model.name}
                    </p>
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
