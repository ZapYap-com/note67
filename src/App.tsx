import { useState, useMemo, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  LogoImage,
  Settings,
  SummaryPanel,
  TranscriptSearch,
  useProfile,
  AudioPlayer,
  UpdateNotification,
  MeetingDetectedPopup,
  AudioFilesList,
} from "./components";
import { exportApi, aiApi, notesApi } from "./api";
import {
  useNotes,
  useModels,
  useOllama,
  useRecording,
  useSummaries,
  useTranscription,
  useLiveTranscription,
  useUpdater,
  useSystemStatus,
  useUploadedAudio,
} from "./hooks";
import { useThemeStore } from "./stores/themeStore";
import type { Note, TranscriptSegment, AudioSegment } from "./types";


function App() {
  const {
    notes,
    loading,
    refresh: refreshNotes,
    createNote,
    updateNote,
    endNote,
    deleteNote,
  } = useNotes();
  const {
    isRecording,
    isPaused,
    audioLevel,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    continueRecording,
  } = useRecording();
  const { loadedModel } = useModels();
  const { loadTranscript } = useTranscription();
  const {
    isLiveTranscribing,
    liveSegments,
    startLiveTranscription,
    stopLiveTranscription
  } = useLiveTranscription();
  const { isRunning: ollamaRunning, selectedModel: ollamaModel } = useOllama();
  const { available: updateAvailable } = useUpdater();
  const { micAvailable, micPermission, systemAudioSupported, systemAudioPermission, loading: systemLoading, refresh: refreshSystemStatus } = useSystemStatus();
  const systemNeedsSetup = !systemLoading && (!micAvailable || !micPermission || (systemAudioSupported && !systemAudioPermission));

  const { profile } = useProfile();
  const theme = useThemeStore((state) => state.theme);
  const loadTheme = useThemeStore((state) => state.loadTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  // Load theme from database on mount
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  // Show main window once frontend is ready (handles autostart gracefully)
  useEffect(() => {
    invoke("show_main_window").catch((err) => {
      console.error("Failed to show main window:", err);
    });
  }, []);

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

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    null
  );
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"profile" | "appearance" | "system" | "whisper" | "ollama" | "privacy" | "shortcuts" | "about" | "updates" | "disclaimer">("about");
  const [noteTranscripts, setNoteTranscripts] = useState<
    Record<string, TranscriptSegment[]>
  >({});
  const [activeTab, setActiveTab] = useState<
    "notes" | "transcript" | "summary"
  >("summary");
  const [editingTitle, setEditingTitle] = useState(false);
  const [, setEditingDescription] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [recordingNoteId, setRecordingNoteId] = useState<string | null>(null);
  const [isGeneratingSummaryTitle, setIsGeneratingSummaryTitle] = useState(false);
  const [summariesRefreshKey, setSummariesRefreshKey] = useState(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "note" | "general";
    noteId?: string;
  } | null>(null);

  const selectedNote =
    notes.find((n) => n.id === selectedNoteId) || null;
  const recordingNote =
    notes.find((n) => n.id === recordingNoteId) || null;
  // Show live segments during recording or when paused, otherwise show saved transcript
  const currentTranscript = selectedNoteId
    ? ((isLiveTranscribing || isPaused) && recordingNoteId === selectedNoteId
        ? liveSegments
        : noteTranscripts[selectedNoteId] || [])
    : [];

  // Group notes by date
  const groupedNotes = useMemo(() => {
    const groups: { label: string; notes: Note[] }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayNotes: Note[] = [];
    const olderGroups: Map<string, Note[]> = new Map();

    notes.forEach((note) => {
      const date = new Date(note.started_at);
      date.setHours(0, 0, 0, 0);
      const diffDays = Math.floor(
        (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 0) {
        todayNotes.push(note);
      } else {
        const label = diffDays === 1 ? "Yesterday" : `${diffDays} days ago`;
        if (!olderGroups.has(label)) {
          olderGroups.set(label, []);
        }
        olderGroups.get(label)!.push(note);
      }
    });

    if (todayNotes.length > 0) {
      groups.push({ label: "Today", notes: todayNotes });
    }

    olderGroups.forEach((noteList, label) => {
      groups.push({ label, notes: noteList });
    });

    return groups;
  }, [notes]);

  const handleNewNote = useCallback(async () => {
    const note = await createNote("Untitled");
    setSelectedNoteId(note.id);
  }, [createNote]);

  const handleStartRecording = useCallback(async () => {
    // Refresh and check microphone permission before starting
    const status = await refreshSystemStatus();
    if (!status.micAvailable || !status.micPermission) {
      setSettingsTab("system");
      setShowSettings(true);
      return;
    }

    const note = await createNote("Untitled");
    setSelectedNoteId(note.id);
    setRecordingNoteId(note.id);
    setActiveTab("transcript");
    await startRecording(note.id);
    // Start live transcription
    await startLiveTranscription(note.id, profile?.name || "Me");
  }, [createNote, startRecording, startLiveTranscription, profile?.name, refreshSystemStatus]);

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
          handleStartRecording();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, loadedModel, ollamaRunning, ollamaModel, handleStartRecording]);

  // Listen for tray "New Note" event
  useEffect(() => {
    const unlisten = listen("tray-new-note", () => {
      // Start a new note if not already recording and setup is complete
      if (!isRecording && loadedModel && ollamaRunning && ollamaModel) {
        handleStartRecording();
      } else {
        // Just create a new note
        handleNewNote();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isRecording, loadedModel, ollamaRunning, ollamaModel, handleStartRecording, handleNewNote]);

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
          setNoteToDelete(null);
        } else if (showSettings) {
          setShowSettings(false);
          refreshSystemStatus();
        } else if (selectedNoteId) {
          setSelectedNoteId(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, showDeleteConfirm, showSettings, selectedNoteId, refreshSystemStatus]);

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
      // Check if clicking on a note item (handled separately)
      const target = e.target as HTMLElement;
      if (target.closest("[data-note-id]")) {
        return; // Let the note-specific handler deal with it
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

  // Handle note right-click
  const handleNoteContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: "note",
      noteId: note.id,
    });
  };

  // Context menu actions
  const handleContextMenuAction = (action: string) => {
    if (action === "delete" && contextMenu?.noteId) {
      const note = notes.find((n) => n.id === contextMenu.noteId);
      if (note) {
        setNoteToDelete(note);
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
    if (recordingNoteId) {
      const noteId = recordingNoteId;
      // Save segments before stopping (to avoid stale closure)
      const segmentsToSave = [...liveSegments];
      const audioPath = await stopRecording();
      // Stop live transcription and save segments to database
      await stopLiveTranscription(noteId);
      await endNote(noteId, audioPath ?? undefined);
      // Reload transcript from database to ensure we have all segments
      const savedSegments = await loadTranscript(noteId);
      const transcriptToUse = savedSegments.length > 0 ? savedSegments : segmentsToSave;
      if (transcriptToUse.length > 0) {
        setNoteTranscripts((prev) => ({
          ...prev,
          [noteId]: transcriptToUse,
        }));
      }
      setRecordingNoteId(null);

      // Always refresh notes to update ended_at
      await refreshNotes();

      // Auto-generate summary and title if we have transcript
      if (transcriptToUse.length > 0) {
        setActiveTab("summary");
        setIsGeneratingSummaryTitle(true);
        try {
          // Generate overview summary first
          const summary = await aiApi.generateSummary(noteId, "overview");
          // Trigger summaries refresh in NoteView
          setSummariesRefreshKey((k) => k + 1);
          // Generate title from summary content
          await aiApi.generateTitleFromSummary(noteId, summary.content);
          // Refresh note list to show new title
          await refreshNotes();
        } catch (error) {
          console.error("Failed to auto-generate summary/title:", error);
        } finally {
          setIsGeneratingSummaryTitle(false);
        }
      }
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + S to stop recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isRecording) {
          handleStopRecording();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording]);

  // Regenerate summary and title for the selected note
  const handleRegenerateSummaryTitle = async () => {
    if (!selectedNoteId) return;

    setIsGeneratingSummaryTitle(true);
    try {
      // Generate overview summary first
      const summary = await aiApi.generateSummary(selectedNoteId, "overview");
      // Trigger summaries refresh in NoteView
      setSummariesRefreshKey((k) => k + 1);
      // Generate title from summary content
      await aiApi.generateTitleFromSummary(selectedNoteId, summary.content);
      // Refresh note list to show new title
      await refreshNotes();
    } catch (error) {
      console.error("Failed to regenerate summary/title:", error);
    } finally {
      setIsGeneratingSummaryTitle(false);
    }
  };

  const handleSelectNote = async (note: Note) => {
    setSelectedNoteId(note.id);
    setActiveTab("summary");
    if (!noteTranscripts[note.id]) {
      const segments = await loadTranscript(note.id);
      if (segments.length > 0) {
        setNoteTranscripts((prev) => ({
          ...prev,
          [note.id]: segments,
        }));
      }
    }
  };

  const handleUpdateTitle = async (title: string) => {
    if (selectedNote && title.trim()) {
      await updateNote(selectedNote.id, { title: title.trim() });
    }
    setEditingTitle(false);
  };

  const handleUpdateDescription = async (description: string) => {
    if (selectedNote) {
      await updateNote(selectedNote.id, {
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
            Notes
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

        {/* Note List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div
              className="px-4 py-6 text-center text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Loading...
            </div>
          ) : groupedNotes.length === 0 ? (
            <div
              className="px-4 py-8 text-center text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <p className="mb-3">No notes yet</p>
              <button
                onClick={async () => {
                  const { seedNotes } = await import("./utils/seeder");
                  await seedNotes(refreshNotes);
                }}
                className="text-xs underline"
                style={{ color: "var(--color-accent)" }}
              >
                Add sample data
              </button>
            </div>
          ) : (
            groupedNotes.map((group) => (
              <div key={group.label} className="mb-1">
                <div
                  className="px-4 py-1.5 text-xs font-medium uppercase tracking-wider"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {group.label}
                </div>
                {group.notes.map((note) => (
                  <button
                    key={note.id}
                    data-note-id={note.id}
                    onClick={() => handleSelectNote(note)}
                    onContextMenu={(e) => handleNoteContextMenu(e, note)}
                    className="w-full px-4 py-2 text-left transition-colors"
                    style={{
                      backgroundColor:
                        selectedNoteId === note.id
                          ? "var(--color-sidebar-selected)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedNoteId !== note.id) {
                        e.currentTarget.style.backgroundColor =
                          "var(--color-sidebar-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedNoteId !== note.id) {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }
                    }}
                  >
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--color-text)" }}
                    >
                      {note.title}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {formatTime(note.started_at)}
                      {isRecording && recordingNoteId === note.id && (
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
              {(!profile.name || !loadedModel || !ollamaRunning || !ollamaModel || updateAvailable || systemNeedsSetup) && (
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
        {selectedNote ? (
          <NoteView
            key={selectedNote.id}
            note={selectedNote}
            transcript={currentTranscript}
            isRecording={isRecording && recordingNoteId === selectedNote.id}
            isPaused={isPaused && recordingNoteId === selectedNote.id}
            audioLevel={audioLevel}
            activeTab={activeTab}
            editingTitle={editingTitle}
            ollamaRunning={ollamaRunning}
            hasOllamaModel={!!ollamaModel}
            isRegenerating={isGeneratingSummaryTitle}
            isTranscribing={isLiveTranscribing && recordingNoteId === selectedNote.id}
            summariesRefreshKey={summariesRefreshKey}
            onTabChange={setActiveTab}
            onEditTitle={() => setEditingTitle(true)}
            onUpdateTitle={handleUpdateTitle}
            onUpdateDescription={handleUpdateDescription}
            onStopRecording={handleStopRecording}
            onPauseRecording={async () => {
              try {
                await pauseRecording();
              } catch (error) {
                console.error("Pause recording failed:", error);
              }
            }}
            onResumeRecording={async () => {
              try {
                // Check microphone permission before resuming
                const status = await refreshSystemStatus();
                if (!status.micAvailable || !status.micPermission) {
                  setSettingsTab("system");
                  setShowSettings(true);
                  return;
                }

                if (recordingNoteId) {
                  await resumeRecording(recordingNoteId);
                  // Pass current liveSegments to preserve them when resuming
                  await startLiveTranscription(recordingNoteId, profile?.name || "Me", liveSegments);
                }
              } catch (error) {
                console.error("Resume recording failed:", error);
              }
            }}
            onContinueRecording={async () => {
              try {
                // Check microphone permission before continuing
                const status = await refreshSystemStatus();
                if (!status.micAvailable || !status.micPermission) {
                  setSettingsTab("system");
                  setShowSettings(true);
                  return;
                }

                setRecordingNoteId(selectedNote.id);
                // Load existing transcripts before starting
                const existingSegments = await loadTranscript(selectedNote.id);
                await continueRecording(selectedNote.id);
                await startLiveTranscription(selectedNote.id, profile?.name || "Me", existingSegments);
                setActiveTab("transcript");
              } catch (error) {
                console.error("Continue recording failed:", error);
              }
            }}
            onDelete={() => setShowDeleteConfirm(true)}
            onExport={async () => {
              try {
                const data = await exportApi.exportMarkdown(selectedNote.id);
                await exportApi.savePdfWithDialog(data.markdown, data.filename);
              } catch (error) {
                console.error("Export failed:", error);
              }
            }}
            onRegenerate={handleRegenerateSummaryTitle}
            onClose={() => setSelectedNoteId(null)}
            onTranscriptUpdated={async () => {
              if (selectedNote) {
                const segments = await loadTranscript(selectedNote.id);
                if (segments.length > 0) {
                  setNoteTranscripts((prev) => ({
                    ...prev,
                    [selectedNote.id]: segments,
                  }));
                }
              }
            }}
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
        {/* Hide when viewing a note (unless recording or generating) */}
        {!(selectedNote && !isRecording && !isGeneratingSummaryTitle) && (
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
          ) : isPaused && recordingNote ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    if (recordingNoteId) {
                      await resumeRecording(recordingNoteId);
                      await startLiveTranscription(recordingNoteId);
                    }
                  } catch (error) {
                    console.error("Resume recording failed:", error);
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm shadow-md transition-transform hover:scale-105"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Resume
              </button>
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm shadow-md transition-transform hover:scale-105"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              >
                Stop
              </button>
            </div>
          ) : isRecording && recordingNote ? (
            <button
              onClick={handleStopRecording}
              className="flex items-center gap-3 px-4 py-2 rounded-full shadow-lg transition-transform hover:scale-105"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
              <span
                className="text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <kbd className="font-medium" style={{ color: "var(--color-text)" }}>
                  {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} + S
                </kbd>
                {" "}to stop
              </span>
            </button>
          ) : (
            <button
              onClick={handleStartRecording}
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
        )}
      </main>

      {/* Modals */}
      {showSettings && <Settings onClose={() => { setShowSettings(false); refreshSystemStatus(); }} initialTab={settingsTab} onTabChange={setSettingsTab} />}
      {showDeleteConfirm && (noteToDelete || selectedNote) && (
        <ConfirmDialog
          title="Delete Note"
          message={`Are you sure you want to delete "${(noteToDelete || selectedNote)!.title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const note = noteToDelete || selectedNote;
            if (note) {
              deleteNote(note.id);
              if (selectedNoteId === note.id) {
                setSelectedNoteId(null);
              }
            }
            setShowDeleteConfirm(false);
            setNoteToDelete(null);
          }}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setNoteToDelete(null);
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

      {/* Update Notification */}
      <UpdateNotification
        onOpenSettings={() => {
          setSettingsTab("updates");
          setShowSettings(true);
        }}
      />

      {/* Meeting Detected Popup */}
      <MeetingDetectedPopup onStartListening={handleStartRecording} />
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
        <LogoImage className="w-32 h-auto mx-auto mb-4" />
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Select a note or start a new one
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
            <span>start recording</span>
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

interface NoteViewProps {
  note: Note;
  transcript: TranscriptSegment[];
  isRecording: boolean;
  isPaused: boolean;
  audioLevel: number;
  activeTab: "notes" | "transcript" | "summary";
  editingTitle: boolean;
  ollamaRunning: boolean;
  hasOllamaModel: boolean;
  isRegenerating: boolean;
  isTranscribing: boolean;
  summariesRefreshKey: number;
  onTabChange: (tab: "notes" | "transcript" | "summary") => void;
  onEditTitle: () => void;
  onUpdateTitle: (title: string) => void;
  onUpdateDescription: (desc: string) => void;
  onStopRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onContinueRecording: () => void;
  onDelete: () => void;
  onExport: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  onTranscriptUpdated?: () => void;
}

function NoteView({
  note,
  transcript,
  isRecording,
  isPaused,
  audioLevel,
  activeTab,
  editingTitle,
  ollamaRunning,
  hasOllamaModel,
  isRegenerating,
  isTranscribing,
  summariesRefreshKey,
  onTabChange,
  onEditTitle,
  onUpdateTitle,
  onUpdateDescription,
  onStopRecording,
  onPauseRecording,
  onResumeRecording,
  onContinueRecording,
  onDelete,
  onExport,
  onRegenerate,
  onClose,
  onTranscriptUpdated,
}: NoteViewProps) {
  const [titleValue, setTitleValue] = useState(note.title);
  const [descValue, setDescValue] = useState(note.description || "");
  const [playingAudioPath, setPlayingAudioPath] = useState<string | null>(note.audio_path || null);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  // Update playingAudioPath when note changes (don't auto-play)
  useEffect(() => {
    setPlayingAudioPath(note.audio_path || null);
    setShouldAutoPlay(false);
  }, [note.id, note.audio_path]);

  // Handle play request from audio files list
  const handlePlayAudio = useCallback((path: string) => {
    setPlayingAudioPath(path);
    setShouldAutoPlay(true);
  }, []);

  const { summaries, isGenerating, streamingContent, deleteSummary } =
    useSummaries(note.id, summariesRefreshKey);

  const {
    uploads,
    isUploading,
    isTranscribing: isTranscribingUpload,
    uploadAudio,
    deleteUpload,
    transcribeUpload,
    loadUploads,
  } = useUploadedAudio(note.id);

  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([]);

  // Load audio segments when note changes
  useEffect(() => {
    notesApi.getAudioSegments(note.id).then(setAudioSegments).catch(console.error);
  }, [note.id]);

  // Refresh both audio segments and uploads after reordering
  const handleAudioReorder = useCallback(() => {
    notesApi.getAudioSegments(note.id).then(setAudioSegments).catch(console.error);
    loadUploads();
  }, [note.id, loadUploads]);

  // Set titleValue to current note.title when entering edit mode
  const handleEditTitle = () => {
    setTitleValue(note.title);
    onEditTitle();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="px-6 py-4 border-b flex items-center justify-between gap-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-black/5 transition-colors shrink-0"
          title="Close"
        >
          <svg
            className="w-5 h-5"
            style={{ color: "var(--color-text-secondary)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
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
              onClick={handleEditTitle}
              className="text-xl font-semibold cursor-text"
              style={{ color: "var(--color-text)" }}
            >
              {note.title}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Recording controls */}
          {isRecording && (
            <>
              <button
                onClick={onPauseRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
                title="Pause recording"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                Pause
              </button>
              <button
                onClick={onStopRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium"
                style={{ backgroundColor: "var(--color-accent)", color: "white" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Stop
              </button>
            </>
          )}
          {/* Paused controls */}
          {isPaused && (
            <>
              <button
                onClick={onResumeRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium"
                style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                title="Resume recording"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Resume
              </button>
              <button
                onClick={onStopRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              >
                Stop
              </button>
            </>
          )}
          {/* Ended/idle note controls - show Listen for any note not currently recording or generating */}
          {!isRecording && !isPaused && !isRegenerating && !isGenerating && (
            <>
              <button
                onClick={onContinueRecording}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full font-medium"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
                title="Listen"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                Listen
              </button>
              <button
                onClick={() => uploadAudio()}
                disabled={isUploading}
                className="p-1 rounded-md hover:bg-black/5 disabled:opacity-50"
                title="Upload Audio"
              >
                {isUploading ? (
                  <div
                    className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                    style={{
                      borderColor: "var(--color-text-secondary)",
                      borderTopColor: "transparent",
                    }}
                  />
                ) : (
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
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                )}
              </button>
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
            </>
          )}
          {!isRecording && !isPaused && (
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

      {/* Paused indicator */}
      {isPaused && (
        <div
          className="px-6 py-2 flex items-center gap-2"
          style={{ backgroundColor: "var(--color-bg-elevated)" }}
        >
          <svg className="w-3 h-3" fill="var(--color-text-secondary)" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
          <span
            className="text-xs font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Paused
          </span>
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
        {/* Generate/Regenerate button - only show on summary tab when ready */}
        {activeTab === "summary" &&
          !isRecording &&
          !isTranscribing &&
          !isGenerating &&
          !isRegenerating &&
          (transcript.length > 0 || descValue.trim().length > 0) &&
          hasOllamaModel &&
          ollamaRunning && (
            <button
              onClick={onRegenerate}
              className="ml-auto my-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all"
              style={{
                backgroundColor: "#374151",
                color: "white",
              }}
            >
              {summaries.length === 0 ? "Generate" : "Regenerate"}
            </button>
          )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === "notes" && (
          <div className="h-full flex flex-col">
            <textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={() => onUpdateDescription(descValue)}
              placeholder="Take notes or press / for commands..."
              className="flex-1 w-full text-base leading-relaxed resize-none"
              style={{ color: "var(--color-text)" }}
            />
            <AudioFilesList
              uploads={uploads}
              segments={audioSegments}
              mainAudioPath={note.audio_path}
              isTranscribing={isTranscribingUpload}
              activeAudioPath={playingAudioPath}
              isPlaying={isAudioPlaying}
              onTranscribe={async (uploadId) => {
                await transcribeUpload(uploadId);
                onTranscriptUpdated?.();
              }}
              onDeleteUpload={deleteUpload}
              onReorder={handleAudioReorder}
              onPlayAudio={handlePlayAudio}
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
              {note.audio_path
                ? "Transcribe this note to see the transcript"
                : "No audio recorded"}
            </div>
          ))}

        {activeTab === "summary" && (
          <SummaryPanel
            summaries={summaries}
            isGenerating={isGenerating}
            streamingContent={streamingContent}
            onDelete={deleteSummary}
            onCopy={async (content) => {
              try {
                await exportApi.copyToClipboard(content);
              } catch (error) {
                console.error("Copy failed:", error);
              }
            }}
          />
        )}
      </div>

      {/* Audio Player - show when there's audio to play and not recording */}
      {!isRecording && playingAudioPath && (
        <AudioPlayer
          audioPath={playingAudioPath}
          title={note.title}
          autoPlay={shouldAutoPlay}
          onAutoPlayHandled={() => setShouldAutoPlay(false)}
          onPlayingChange={setIsAudioPlaying}
        />
      )}
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
  type: "note" | "general";
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
    type === "note"
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
