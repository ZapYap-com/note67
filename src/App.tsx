import { useState, useMemo, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Settings,
  SummaryPanel,
  TranscriptSearch,
  useProfile,
} from "./components";
import { exportApi, aiApi } from "./api";
import {
  useMeetings,
  useModels,
  useOllama,
  useRecording,
  useSummaries,
  useTranscription,
  useLiveTranscription,
} from "./hooks";
import { useThemeStore } from "./stores/themeStore";
import type { Meeting, SummaryType, TranscriptSegment } from "./types";

// Import seeder for dev console access
import "./utils/seeder";

function App() {
  const {
    meetings,
    loading,
    refresh: refreshMeetings,
    createMeeting,
    updateMeeting,
    endMeeting,
    deleteMeeting,
  } = useMeetings();
  const { isRecording, audioLevel, startRecording, stopRecording } =
    useRecording();
  const { loadedModel } = useModels();
  const { loadTranscript } = useTranscription();
  const {
    isLiveTranscribing,
    liveSegments,
    startLiveTranscription,
    stopLiveTranscription
  } = useLiveTranscription();
  const { isRunning: ollamaRunning, selectedModel: ollamaModel } = useOllama();

  const { profile } = useProfile();
  const theme = useThemeStore((state) => state.theme);
  const loadTheme = useThemeStore((state) => state.loadTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  // Load theme from database on mount
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        const root = document.documentElement;
        root.classList.toggle("dark", mediaQuery.matches);
      };
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null
  );
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"profile" | "appearance" | "system" | "whisper" | "ollama" | "privacy" | "shortcuts" | "about" | "updates" | "disclaimer">("about");
  const [meetingTranscripts, setMeetingTranscripts] = useState<
    Record<string, TranscriptSegment[]>
  >({});
  const [activeTab, setActiveTab] = useState<
    "notes" | "transcript" | "summary"
  >("summary");
  const [editingTitle, setEditingTitle] = useState(false);
  const [, setEditingDescription] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [meetingToDelete, setMeetingToDelete] = useState<Meeting | null>(null);
  const [recordingMeetingId, setRecordingMeetingId] = useState<string | null>(null);
  const [isGeneratingSummaryTitle, setIsGeneratingSummaryTitle] = useState(false);
  const [summariesRefreshKey, setSummariesRefreshKey] = useState(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "meeting" | "general";
    meetingId?: string;
  } | null>(null);

  const selectedMeeting =
    meetings.find((m) => m.id === selectedMeetingId) || null;
  const recordingMeeting =
    meetings.find((m) => m.id === recordingMeetingId) || null;
  // Show live segments during recording, otherwise show saved transcript
  const currentTranscript = selectedMeetingId
    ? (isLiveTranscribing && recordingMeetingId === selectedMeetingId
        ? liveSegments
        : meetingTranscripts[selectedMeetingId] || [])
    : [];

  // Group meetings by date
  const groupedMeetings = useMemo(() => {
    const groups: { label: string; meetings: Meeting[] }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayMeetings: Meeting[] = [];
    const olderGroups: Map<string, Meeting[]> = new Map();

    meetings.forEach((meeting) => {
      const date = new Date(meeting.started_at);
      date.setHours(0, 0, 0, 0);
      const diffDays = Math.floor(
        (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 0) {
        todayMeetings.push(meeting);
      } else {
        const label = diffDays === 1 ? "Yesterday" : `${diffDays} days ago`;
        if (!olderGroups.has(label)) {
          olderGroups.set(label, []);
        }
        olderGroups.get(label)!.push(meeting);
      }
    });

    if (todayMeetings.length > 0) {
      groups.push({ label: "Today", meetings: todayMeetings });
    }

    olderGroups.forEach((meetings, label) => {
      groups.push({ label, meetings });
    });

    return groups;
  }, [meetings]);

  const handleNewNote = useCallback(async () => {
    const meeting = await createMeeting("Untitled");
    setSelectedMeetingId(meeting.id);
  }, [createMeeting]);

  const handleStartMeeting = useCallback(async () => {
    const meeting = await createMeeting("Untitled");
    setSelectedMeetingId(meeting.id);
    setRecordingMeetingId(meeting.id);
    setActiveTab("transcript");
    await startRecording(meeting.id);
    // Start live transcription
    await startLiveTranscription(meeting.id, profile?.name || "Me");
  }, [createMeeting, startRecording, startLiveTranscription, profile?.name]);

  // Keyboard shortcut: Cmd/Ctrl + N for new note
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        handleNewNote();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewNote]);

  // Keyboard shortcut: Cmd/Ctrl + R for new note and start recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        // Only start if not already recording and setup is complete
        if (!isRecording && loadedModel && ollamaRunning && ollamaModel) {
          handleStartMeeting();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, loadedModel, ollamaRunning, ollamaModel, handleStartMeeting]);

  // Listen for tray "New Meeting" event
  useEffect(() => {
    const unlisten = listen("tray-new-meeting", () => {
      // Start a new meeting if not already recording and setup is complete
      if (!isRecording && loadedModel && ollamaRunning && ollamaModel) {
        handleStartMeeting();
      } else {
        // Just create a new note
        handleNewNote();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isRecording, loadedModel, ollamaRunning, ollamaModel, handleStartMeeting, handleNewNote]);

  // Listen for tray "Settings" event
  useEffect(() => {
    const unlisten = listen("tray-open-settings", () => {
      setSettingsTab("about");
      setShowSettings(true);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keyboard shortcut: ESC to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
        } else if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
          setMeetingToDelete(null);
        } else if (showSettings) {
          setShowSettings(false);
        } else if (selectedMeetingId) {
          setSelectedMeetingId(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, showDeleteConfirm, showSettings, selectedMeetingId]);

  // Keyboard shortcut: Cmd/Ctrl + , to toggle settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => {
          if (!prev) {
            // Opening settings - reset to About tab
            setSettingsTab("about");
          }
          return !prev;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + M to toggle theme
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "m") {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme]);

  // Global right-click handler - prevent default and show custom menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Check if clicking on a meeting item (handled separately)
      const target = e.target as HTMLElement;
      if (target.closest("[data-meeting-id]")) {
        return; // Let the meeting-specific handler deal with it
      }
      // Show general context menu
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: "general",
      });
    };

    const handleClick = () => {
      setContextMenu(null);
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("click", handleClick);
    };
  }, []);

  // Handle meeting right-click
  const handleMeetingContextMenu = (e: React.MouseEvent, meeting: Meeting) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: "meeting",
      meetingId: meeting.id,
    });
  };

  // Context menu actions
  const handleContextMenuAction = (action: string) => {
    if (action === "delete" && contextMenu?.meetingId) {
      const meeting = meetings.find((m) => m.id === contextMenu.meetingId);
      if (meeting) {
        setMeetingToDelete(meeting);
        setShowDeleteConfirm(true);
      }
    } else if (action === "settings") {
      setSettingsTab("about");
      setShowSettings(true);
    } else if (action === "privacy") {
      setSettingsTab("privacy");
      setShowSettings(true);
    } else if (action === "about") {
      setSettingsTab("about");
      setShowSettings(true);
    }
    setContextMenu(null);
  };

  const handleStopRecording = async () => {
    if (recordingMeetingId) {
      const meetingId = recordingMeetingId;
      const audioPath = await stopRecording();
      // Stop live transcription and save segments to database
      await stopLiveTranscription(meetingId);
      await endMeeting(meetingId, audioPath ?? undefined);
      // Store live segments as the meeting's transcript
      if (liveSegments.length > 0) {
        setMeetingTranscripts((prev) => ({
          ...prev,
          [meetingId]: liveSegments,
        }));
      }
      setRecordingMeetingId(null);

      // Auto-generate summary and title if we have transcript
      if (liveSegments.length > 0) {
        setActiveTab("summary");
        setIsGeneratingSummaryTitle(true);
        try {
          // Generate overview summary first
          const summary = await aiApi.generateSummary(meetingId, "overview");
          // Trigger summaries refresh in MeetingView
          setSummariesRefreshKey((k) => k + 1);
          // Generate title from summary content
          await aiApi.generateTitleFromSummary(meetingId, summary.content);
          // Refresh meeting list to show new title
          await refreshMeetings();
        } catch (error) {
          console.error("Failed to auto-generate summary/title:", error);
        } finally {
          setIsGeneratingSummaryTitle(false);
        }
      }
    }
  };

  // Regenerate summary and title for the selected meeting
  const handleRegenerateSummaryTitle = async () => {
    if (!selectedMeetingId) return;

    setIsGeneratingSummaryTitle(true);
    try {
      // Generate overview summary first
      const summary = await aiApi.generateSummary(selectedMeetingId, "overview");
      // Trigger summaries refresh in MeetingView
      setSummariesRefreshKey((k) => k + 1);
      // Generate title from summary content
      await aiApi.generateTitleFromSummary(selectedMeetingId, summary.content);
      // Refresh meeting list to show new title
      await refreshMeetings();
    } catch (error) {
      console.error("Failed to regenerate summary/title:", error);
    } finally {
      setIsGeneratingSummaryTitle(false);
    }
  };

  const handleSelectMeeting = async (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    if (!meetingTranscripts[meeting.id]) {
      const segments = await loadTranscript(meeting.id);
      if (segments.length > 0) {
        setMeetingTranscripts((prev) => ({
          ...prev,
          [meeting.id]: segments,
        }));
      }
    }
  };

  const handleUpdateTitle = async (title: string) => {
    if (selectedMeeting && title.trim()) {
      await updateMeeting(selectedMeeting.id, { title: title.trim() });
    }
    setEditingTitle(false);
  };

  const handleUpdateDescription = async (description: string) => {
    if (selectedMeeting) {
      await updateMeeting(selectedMeeting.id, {
        description: description.trim() || undefined,
      });
    }
    setEditingDescription(false);
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <aside
        className="flex flex-col border-r"
        style={{
          width: "var(--sidebar-width)",
          backgroundColor: "var(--color-sidebar)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Sidebar Header */}
        <div className="px-4 py-3 flex items-center justify-between">
          <span
            className="text-base font-semibold"
            style={{ color: "var(--color-text)" }}
          >
            Meetings
          </span>
          <button
            onClick={handleNewNote}
            className="p-2 rounded-lg hover:bg-black/5 transition-colors"
            title="New Note (⌘N)"
          >
            <svg
              className="w-4 h-4"
              style={{ color: "var(--color-text-secondary)" }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>

        {/* Meeting List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div
              className="px-4 py-6 text-center text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Loading...
            </div>
          ) : groupedMeetings.length === 0 ? (
            <div
              className="px-4 py-8 text-center text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <p className="mb-3">No meetings yet</p>
              <button
                onClick={async () => {
                  const { seedMeetings } = await import("./utils/seeder");
                  await seedMeetings();
                }}
                className="text-xs underline"
                style={{ color: "var(--color-accent)" }}
              >
                Add sample data
              </button>
            </div>
          ) : (
            groupedMeetings.map((group) => (
              <div key={group.label} className="mb-1">
                <div
                  className="px-4 py-1.5 text-xs font-medium uppercase tracking-wider"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {group.label}
                </div>
                {group.meetings.map((meeting) => (
                  <button
                    key={meeting.id}
                    data-meeting-id={meeting.id}
                    onClick={() => handleSelectMeeting(meeting)}
                    onContextMenu={(e) => handleMeetingContextMenu(e, meeting)}
                    className="w-full px-4 py-2 text-left transition-colors"
                    style={{
                      backgroundColor:
                        selectedMeetingId === meeting.id
                          ? "var(--color-sidebar-selected)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedMeetingId !== meeting.id) {
                        e.currentTarget.style.backgroundColor =
                          "var(--color-sidebar-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedMeetingId !== meeting.id) {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }
                    }}
                  >
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--color-text)" }}
                    >
                      {meeting.title}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {formatTime(meeting.started_at)}
                      {isRecording && recordingMeetingId === meeting.id && (
                        <span
                          className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: "var(--color-accent-light)",
                            color: "var(--color-accent)",
                          }}
                        >
                          Live
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div
          className="px-3 py-2.5 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          {/* Model badges */}
          {(loadedModel || (ollamaRunning && ollamaModel)) && (
            <div
              className="flex flex-wrap items-center gap-1.5 text-xs mb-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {loadedModel && (
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "var(--color-sidebar-hover)" }}
                >
                  {loadedModel}
                </span>
              )}
              {ollamaRunning && ollamaModel && (
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "var(--color-sidebar-hover)" }}
                >
                  {ollamaModel.split(":")[0]}
                </span>
              )}
            </div>
          )}

          {/* User profile */}
          <button
            onClick={() => {
              setSettingsTab("about");
              setShowSettings(true);
            }}
            className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 transition-colors"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
              style={{
                backgroundColor: profile.avatar ? "var(--color-accent-light)" : "var(--color-sidebar-hover)",
                color: profile.avatar ? "var(--color-text)" : "var(--color-text-secondary)",
              }}
            >
              {profile.avatar || (profile.name ? profile.name[0].toUpperCase() : "?")}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div
                className="text-sm font-medium truncate"
                style={{ color: "var(--color-text)" }}
              >
                {profile.name || "Set up profile"}
              </div>
              {profile.email && (
                <div
                  className="text-xs truncate"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {profile.email}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {(!profile.name || !loadedModel || !ollamaRunning || !ollamaModel) && (
                <svg
                  className="w-4 h-4 mt-0.5"
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
              )}
              <svg
                className="w-6 h-6"
                style={{ color: "var(--color-text-tertiary)" }}
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
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className="flex-1 flex flex-col relative"
        style={{ backgroundColor: "var(--color-bg)" }}
      >
        {selectedMeeting ? (
          <MeetingView
            meeting={selectedMeeting}
            transcript={currentTranscript}
            isRecording={isRecording && recordingMeetingId === selectedMeeting.id}
            audioLevel={audioLevel}
            activeTab={activeTab}
            editingTitle={editingTitle}
            ollamaRunning={ollamaRunning}
            hasOllamaModel={!!ollamaModel}
            isRegenerating={isGeneratingSummaryTitle}
            summariesRefreshKey={summariesRefreshKey}
            onTabChange={setActiveTab}
            onEditTitle={() => setEditingTitle(true)}
            onUpdateTitle={handleUpdateTitle}
            onUpdateDescription={handleUpdateDescription}
            onStopRecording={handleStopRecording}
            onDelete={() => setShowDeleteConfirm(true)}
            onExport={async () => {
              const data = await exportApi.exportMarkdown(selectedMeeting.id);
              await exportApi.saveToFile(data.markdown, data.filename);
            }}
            onCopy={async () => {
              const data = await exportApi.exportMarkdown(selectedMeeting.id);
              await exportApi.copyToClipboard(data.markdown);
            }}
            onRegenerate={handleRegenerateSummaryTitle}
          />
        ) : (
          <EmptyState
            needsSetup={!loadedModel || !ollamaRunning || !ollamaModel}
            onOpenSettings={() => {
              setSettingsTab("whisper");
              setShowSettings(true);
            }}
          />
        )}

        {/* Start Listening Button, Recording Indicator, or Generating Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          {isGeneratingSummaryTitle ? (
            <div
              className="flex items-center gap-3 px-4 py-2 rounded-full shadow-lg"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div
                className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                style={{
                  borderColor: "var(--color-accent)",
                  borderTopColor: "transparent",
                }}
              />
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text)" }}
              >
                Generating Summary
              </span>
            </div>
          ) : isRecording && recordingMeeting ? (
            <div
              className="flex items-center gap-3 px-4 py-2 rounded-full shadow-lg"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
              <button
                onClick={() => setSelectedMeetingId(recordingMeetingId)}
                className="text-sm font-medium hover:underline"
                style={{ color: "var(--color-text)" }}
              >
                {recordingMeeting.title}
              </button>
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                Stop
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartMeeting}
              disabled={!loadedModel || !ollamaRunning || !ollamaModel}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm shadow-md transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 hover:scale-105"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
              title={!loadedModel || !ollamaRunning || !ollamaModel ? "Complete setup in Settings first" : undefined}
            >
              <span className="w-2 h-2 rounded-full bg-white" />
              Start listening
            </button>
          )}
        </div>
      </main>

      {/* Modals */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} initialTab={settingsTab} />}
      {showDeleteConfirm && (meetingToDelete || selectedMeeting) && (
        <ConfirmDialog
          title="Delete Meeting"
          message={`Are you sure you want to delete "${(meetingToDelete || selectedMeeting)!.title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const meeting = meetingToDelete || selectedMeeting;
            if (meeting) {
              deleteMeeting(meeting.id);
              if (selectedMeetingId === meeting.id) {
                setSelectedMeetingId(null);
              }
            }
            setShowDeleteConfirm(false);
            setMeetingToDelete(null);
          }}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setMeetingToDelete(null);
          }}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          onAction={handleContextMenuAction}
        />
      )}
    </div>
  );
}

interface EmptyStateProps {
  needsSetup: boolean;
  onOpenSettings: () => void;
}

function EmptyState({ needsSetup, onOpenSettings }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center pb-20">
      <div className="text-center max-w-sm px-6">
        {/* Logo with wordmark */}
        <svg
          className="w-44 h-auto mx-auto mb-4"
          viewBox="0 0 180 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Icon - rounded square with note + audio waves */}
          <rect
            x="2"
            y="4"
            width="40"
            height="40"
            rx="10"
            fill="var(--color-accent)"
          />
          <path
            d="M12 12h14l6 6v16a1.5 1.5 0 01-1.5 1.5h-17A1.5 1.5 0 0112 34V13.5A1.5 1.5 0 0113.5 12z"
            fill="white"
            fillOpacity="0.95"
          />
          <path
            d="M26 12v5a1 1 0 001 1h5l-6-6z"
            fill="white"
            fillOpacity="0.6"
          />
          <rect
            x="16"
            y="23"
            width="1.5"
            height="6"
            rx="0.75"
            fill="var(--color-accent)"
          />
          <rect
            x="20"
            y="20"
            width="1.5"
            height="12"
            rx="0.75"
            fill="var(--color-accent)"
          />
          <rect
            x="24"
            y="22"
            width="1.5"
            height="8"
            rx="0.75"
            fill="var(--color-accent)"
          />
          <rect
            x="28"
            y="19"
            width="1.5"
            height="14"
            rx="0.75"
            fill="var(--color-accent)"
          />

          {/* Wordmark */}
          <text
            x="52"
            y="34"
            fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
            fontSize="28"
            fontWeight="600"
            letterSpacing="-0.5"
            fill="var(--color-text)"
          >
            Note
          </text>
          <text
            x="112.5"
            y="34"
            fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
            fontSize="28"
            fontWeight="600"
            letterSpacing="-0.5"
            fill="var(--color-accent)"
          >
            67
          </text>
        </svg>
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Select a meeting or start a new one
        </p>
        <div
          className="mt-4 flex flex-col items-start gap-2 text-xs mx-auto w-fit"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              N
            </kbd>
            <span>new note</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              R
            </kbd>
            <span>start meeting</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              M
            </kbd>
            <span>toggle theme</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ,
            </kbd>
            <span>settings</span>
          </div>
        </div>
        {needsSetup && (
          <button
            onClick={onOpenSettings}
            className="mt-4 flex items-center gap-2 mx-auto px-3 py-2 text-sm rounded-lg transition-colors hover:bg-black/5"
            style={{
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }}
          >
            <svg
              className="w-4 h-4"
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
            Set up Whisper & Ollama
          </button>
        )}
      </div>
    </div>
  );
}

interface MeetingViewProps {
  meeting: Meeting;
  transcript: TranscriptSegment[];
  isRecording: boolean;
  audioLevel: number;
  activeTab: "notes" | "transcript" | "summary";
  editingTitle: boolean;
  ollamaRunning: boolean;
  hasOllamaModel: boolean;
  isRegenerating: boolean;
  summariesRefreshKey: number;
  onTabChange: (tab: "notes" | "transcript" | "summary") => void;
  onEditTitle: () => void;
  onUpdateTitle: (title: string) => void;
  onUpdateDescription: (desc: string) => void;
  onStopRecording: () => void;
  onDelete: () => void;
  onExport: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}

function MeetingView({
  meeting,
  transcript,
  isRecording,
  audioLevel,
  activeTab,
  editingTitle,
  ollamaRunning,
  hasOllamaModel,
  isRegenerating,
  summariesRefreshKey,
  onTabChange,
  onEditTitle,
  onUpdateTitle,
  onUpdateDescription,
  onStopRecording,
  onDelete,
  onExport,
  onCopy,
  onRegenerate,
}: MeetingViewProps) {
  const [titleValue, setTitleValue] = useState(meeting.title);
  const [descValue, setDescValue] = useState(meeting.description || "");

  const { summaries, isGenerating, streamingContent, generateSummary, deleteSummary } =
    useSummaries(meeting.id, summariesRefreshKey);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="px-6 py-4 border-b flex items-center justify-between"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex-1">
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => onUpdateTitle(titleValue)}
              onKeyDown={(e) => e.key === "Enter" && onUpdateTitle(titleValue)}
              className="text-xl font-semibold w-full"
              style={{ color: "var(--color-text)" }}
            />
          ) : (
            <h1
              onClick={onEditTitle}
              className="text-xl font-semibold cursor-text"
              style={{ color: "var(--color-text)" }}
            >
              {meeting.title}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isRecording && (
            <button
              onClick={onStopRecording}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium"
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Stop
            </button>
          )}
          {!isRecording && meeting.ended_at && (
            <>
              <button
                onClick={onExport}
                className="p-1 rounded-md hover:bg-black/5"
                title="Export"
              >
                <svg
                  className="w-4 h-4"
                  style={{ color: "var(--color-text-secondary)" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
              <button
                onClick={onCopy}
                className="p-1 rounded-md hover:bg-black/5"
                title="Copy"
              >
                <svg
                  className="w-4 h-4"
                  style={{ color: "var(--color-text-secondary)" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
            </>
          )}
          {!isRecording && (
            <button
              onClick={onDelete}
              className="p-1 rounded-md hover:bg-black/5"
              title="Delete"
            >
              <svg
                className="w-4 h-4"
                style={{ color: "var(--color-text-secondary)" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Recording indicator */}
      {isRecording && (
        <div
          className="px-6 py-2 flex items-center gap-2"
          style={{ backgroundColor: "var(--color-accent-light)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          <span
            className="text-xs font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            Recording
          </span>
          <div
            className="flex-1 h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: "rgba(229, 77, 46, 0.2)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-100"
              style={{
                width: `${Math.min(100, audioLevel * 400)}%`,
                backgroundColor: "var(--color-accent)",
              }}
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        className="px-6 border-b flex gap-6"
        style={{ borderColor: "var(--color-border)" }}
      >
        {(["notes", "transcript", "summary"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className="py-2.5 text-sm font-medium capitalize transition-colors"
            style={{
              color:
                activeTab === tab
                  ? "var(--color-text)"
                  : "var(--color-text-secondary)",
              borderBottom:
                activeTab === tab
                  ? "2px solid var(--color-text)"
                  : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {tab}
            {tab === "transcript" && transcript.length > 0 && (
              <span
                className="ml-1.5 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                ({transcript.length})
              </span>
            )}
            {tab === "summary" && summaries.length > 0 && (
              <span
                className="ml-1.5 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                ({summaries.length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === "notes" && (
          <div>
            <textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={() => onUpdateDescription(descValue)}
              placeholder="Take notes or press / for commands..."
              className="w-full min-h-[300px] text-base leading-relaxed resize-none"
              style={{ color: "var(--color-text)" }}
            />
          </div>
        )}

        {activeTab === "transcript" &&
          (transcript.length > 0 ? (
            <TranscriptSearch segments={transcript} isLive={isRecording} />
          ) : (
            <div
              className="text-center py-12 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {meeting.audio_path
                ? "Transcribe this meeting to see the transcript"
                : "No audio recorded"}
            </div>
          ))}

        {activeTab === "summary" && (
          <SummaryPanel
            summaries={summaries}
            isGenerating={isGenerating}
            streamingContent={streamingContent}
            hasTranscript={transcript.length > 0}
            hasOllamaModel={hasOllamaModel}
            ollamaRunning={ollamaRunning}
            onGenerate={(type: SummaryType, prompt?: string) =>
              generateSummary(type, prompt)
            }
            onDelete={deleteSummary}
            onRegenerate={onRegenerate}
            isRegenerating={isRegenerating}
          />
        )}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-xl p-5"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: "var(--color-text)" }}
        >
          {title}
        </h3>
        <p
          className="text-sm mb-5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg transition-colors"
            style={{
              backgroundColor: "var(--color-sidebar)",
              color: "var(--color-text)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  type: "meeting" | "general";
  onAction: (action: string) => void;
}

function ContextMenu({ x, y, type, onAction }: ContextMenuProps) {
  // Adjust position to keep menu in viewport
  const menuRef = (node: HTMLDivElement | null) => {
    if (node) {
      const rect = node.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        node.style.left = `${window.innerWidth - rect.width - 8}px`;
      }
      if (rect.bottom > window.innerHeight) {
        node.style.top = `${window.innerHeight - rect.height - 8}px`;
      }
    }
  };

  const menuItems =
    type === "meeting"
      ? [
          {
            id: "delete",
            label: "Delete",
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
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            ),
            danger: true,
          },
        ]
      : [
          {
            id: "settings",
            label: "Settings",
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
          {
            id: "privacy",
            label: "Best Practices",
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
            id: "about",
            label: "About",
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
        ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[160px] py-1.5 rounded-lg"
      style={{
        left: x,
        top: y,
        backgroundColor: "var(--color-bg-elevated)",
        boxShadow:
          "0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
      }}
    >
      {menuItems.map((item) => {
        const isDanger = "danger" in item && item.danger;
        return (
          <button
            key={item.id}
            onClick={() => onAction(item.id)}
            className="w-full px-3 py-1.5 flex items-center gap-2.5 text-sm transition-colors hover:bg-black/5"
            style={{
              color: isDanger ? "#ef4444" : "var(--color-text)",
            }}
          >
            <span style={{ color: isDanger ? "#ef4444" : "var(--color-text-secondary)" }}>
              {item.icon}
            </span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default App;
