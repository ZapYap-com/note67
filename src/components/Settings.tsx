import { useState, useEffect } from "react";
import { useModels, useOllama } from "../hooks";
import type { ModelInfo, ModelSize } from "../types";

export interface UserProfile {
  name: string;
  email: string;
  avatar: string; // initials or emoji
}

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  email: "",
  avatar: "",
};

function loadProfile(): UserProfile {
  try {
    const saved = localStorage.getItem("note67_profile");
    if (saved) {
      return { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Failed to load profile:", e);
  }
  return DEFAULT_PROFILE;
}

function saveProfile(profile: UserProfile): void {
  localStorage.setItem("note67_profile", JSON.stringify(profile));
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile>(loadProfile);

  const updateProfile = (updates: Partial<UserProfile>) => {
    const newProfile = { ...profile, ...updates };
    setProfile(newProfile);
    saveProfile(newProfile);
  };

  return { profile, updateProfile };
}

type SettingsTab = "profile" | "whisper" | "ollama";

interface SettingsProps {
  onClose: () => void;
  initialTab?: SettingsTab;
}

const WarningIcon = () => (
  <svg className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
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

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; warning: boolean }[] = [
    {
      id: "profile",
      label: "Profile",
      warning: profileNeedsSetup,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: "whisper",
      label: "Whisper",
      warning: whisperNeedsSetup,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      ),
    },
    {
      id: "ollama",
      label: "Ollama",
      warning: ollamaNeedsSetup,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
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
        className="w-full max-w-2xl rounded-2xl overflow-hidden flex"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
          height: "500px",
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
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
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
                  backgroundColor: activeTab === tab.id ? "var(--color-sidebar-selected)" : "transparent",
                  color: activeTab === tab.id ? "var(--color-text)" : "var(--color-text-secondary)",
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
            <h3 className="text-base font-medium" style={{ color: "var(--color-text)" }}>
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-1 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "whisper" && <WhisperTab />}
            {activeTab === "ollama" && <OllamaTab />}
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

  useEffect(() => {
    setName(profile.name);
    setEmail(profile.email);
    setAvatar(profile.avatar);
  }, [profile]);

  const handleSave = () => {
    updateProfile({ name, email, avatar });
  };

  const avatarOptions = ["😊", "🎯", "💼", "🎨", "🚀", "💡", "🎵", "📚"];

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text)" }}>
          Avatar
        </label>
        <div className="flex gap-2 flex-wrap">
          {avatarOptions.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                setAvatar(emoji);
                updateProfile({ avatar: emoji });
              }}
              className="w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all"
              style={{
                backgroundColor: avatar === emoji ? "var(--color-accent-light)" : "var(--color-bg-subtle)",
                border: avatar === emoji ? "2px solid var(--color-accent)" : "2px solid transparent",
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text)" }}>
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSave}
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
        <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text)" }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={handleSave}
          placeholder="your@email.com"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
        />
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Your profile is stored locally on this device.
      </p>
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
          style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", color: "#dc2626" }}
        >
          {error}
        </div>
      )}

      <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
        Download a model for local transcription. Larger models are more accurate but slower.
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

      <p className="mt-4 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
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
        backgroundColor: isLoaded ? "rgba(34, 197, 94, 0.06)" : "var(--color-bg-subtle)",
        border: isLoaded ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid transparent",
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
                style={{ backgroundColor: "rgba(34, 197, 94, 0.15)", color: "#16a34a" }}
              >
                Active
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
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

function OllamaTab() {
  const { loading, error, isRunning, models, selectedModel, selectModel, checkStatus } =
    useOllama();

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
  );
}
