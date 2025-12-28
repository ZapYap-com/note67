import { useState, useEffect } from "react";
import { useModels, useOllama, useUpdater, useSystemStatus } from "../../hooks";
import { useProfile } from "./useProfile";
import { WarningIcon } from "./WarningIcon";
import { ProfileTab } from "./ProfileTab";
import { AppearanceTab } from "./AppearanceTab";
import { SystemTab } from "./SystemTab";
import { WhisperTab } from "./WhisperTab";
import { OllamaTab } from "./OllamaTab";
import { PrivacyTab } from "./PrivacyTab";
import { ShortcutsTab } from "./ShortcutsTab";
import { AboutTab } from "./AboutTab";
import { UpdatesTab } from "./UpdatesTab";
import { DisclaimerTab } from "./DisclaimerTab";

type SettingsTab =
  | "profile"
  | "appearance"
  | "system"
  | "whisper"
  | "ollama"
  | "privacy"
  | "shortcuts"
  | "about"
  | "updates"
  | "disclaimer";

interface SettingsProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
}

const DEFAULT_TAB: SettingsTab = "about";

export function Settings({ onClose, initialTab = DEFAULT_TAB, onTabChange }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const { profile } = useProfile();

  // Sync activeTab when initialTab changes (e.g., clicking Details while modal is open)
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Handle tab change and notify parent to keep state in sync
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const { loadedModel } = useModels();
  const { isRunning: ollamaRunning, selectedModel: ollamaModel } = useOllama();
  const { available: updateAvailable } = useUpdater();
  const { micAvailable, micPermission, systemAudioSupported, systemAudioPermission, loading: systemLoading } = useSystemStatus();

  // Check if each setting needs attention
  const profileNeedsSetup = !profile.name;
  const whisperNeedsSetup = !loadedModel;
  const ollamaNeedsSetup = !ollamaRunning || !ollamaModel;
  const systemNeedsSetup = !systemLoading && (!micAvailable || !micPermission || (systemAudioSupported && !systemAudioPermission));

  type TabItem = {
    id: SettingsTab;
    label: string;
    icon: React.ReactNode;
    warning: boolean;
  };

  type TabSection = {
    title: string;
    tabs: TabItem[];
  };

  const sections: TabSection[] = [
    {
      title: "General",
      tabs: [
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
          id: "system",
          label: "System",
          warning: systemNeedsSetup,
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
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          ),
        },
      ],
    },
    {
      title: "AI & Models",
      tabs: [
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
      ],
    },
    {
      title: "Help & Info",
      tabs: [
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
          id: "updates",
          label: "Updates",
          warning: updateAvailable,
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
        {
          id: "disclaimer",
          label: "Disclaimer",
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
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          ),
        },
      ],
    },
  ];

  // Flatten tabs for header lookup
  const allTabs = sections.flatMap((section) => section.tabs);

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
          <nav className="flex-1 px-2 overflow-y-auto">
            {sections.map((section, sectionIndex) => (
              <div
                key={section.title}
                className={sectionIndex > 0 ? "mt-4" : ""}
              >
                <h3
                  className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {section.title}
                </h3>
                {section.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
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
              </div>
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
              {allTabs.find((t) => t.id === activeTab)?.label}
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
            {activeTab === "system" && <SystemTab />}
            {activeTab === "whisper" && <WhisperTab />}
            {activeTab === "ollama" && <OllamaTab />}
            {activeTab === "privacy" && <PrivacyTab />}
            {activeTab === "shortcuts" && <ShortcutsTab />}
            {activeTab === "about" && <AboutTab />}
            {activeTab === "updates" && <UpdatesTab />}
            {activeTab === "disclaimer" && <DisclaimerTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
