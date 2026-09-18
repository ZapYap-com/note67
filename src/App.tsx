import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings,
  useProfile,
  UpdateNotification,
  MeetingDetectedPopup,
  NoteSearchWithTags,
  SearchModal,
  OnboardingWizard,
  TasksView,
  EmptyState,
  NoteView,
  ConfirmDialog,
  ContextMenu,
} from "./components";
import { exportApi, aiApi, transcriptionApi, tagsApi } from "./api";
import { getTagColor } from "./utils/tagColors";
import { useTagsStore } from "./stores/tagsStore";
import {
  useNotes,
  useModels,
  useOllama,
  useRecording,
  useTranscription,
  useLiveTranscription,
  useUpdater,
  useSystemStatus,
  useOnboarding,
} from "./hooks";
import { useThemeStore } from "./stores/themeStore";
import { useRecordingStore } from "./stores/recordingStore";
import { useLiveTranscriptionStore } from "./stores/liveTranscriptionStore";
import { useSummaryUiStore } from "./stores/summaryUiStore";
import { useNoteUiStore, flushPendingNoteSave } from "./stores/noteUiStore";
import { useMeetingStore } from "./stores/meetingStore";
import type { Note, TranscriptSegment } from "./types";

// Lazy-loaded: GraphView pulls in d3, which is only needed on the graph view.
const GraphView = lazy(() =>
  import("./components/graph").then((m) => ({ default: m.GraphView }))
);

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
  // App is the single owner of useRecording (it runs the level-polling effect).
  // audioLevel/recordingMode are read from the store by the components that
  // need them. useRecording doesn't subscribe to audioLevel at all: it updates
  // every 100 ms while recording, and re-rendering App at that rate kept
  // resetting NoteView's autosave timer.
  const {
    isRecording,
    isPaused,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    continueRecording,
  } = useRecording();
  const { loadedModel, initialized: whisperChecked } = useModels();
  const { loadTranscript } = useTranscription();
  const {
    isLiveTranscribing,
    liveSegments,
    startLiveTranscription,
    stopLiveTranscription,
  } = useLiveTranscription();
  const {
    isRunning: ollamaRunning,
    selectedModel: ollamaModel,
    status: ollamaStatus,
    checkStatus: checkOllamaStatus,
  } = useOllama();
  const { available: updateAvailable } = useUpdater();
  const {
    micAvailable,
    micPermission,
    systemAudioSupported,
    systemAudioPermission,
    loading: systemLoading,
    refresh: refreshSystemStatus,
  } = useSystemStatus();
  // System needs setup only when *no* audio input is available.
  // Listen-only (system-audio-only) recording is allowed when mic is missing
  // but system audio is granted, so we don't warn in that case.
  const micOk = micAvailable && micPermission;
  const systemOk = systemAudioSupported && systemAudioPermission;
  const systemNeedsSetup = !systemLoading && !micOk && !systemOk;

  // First-run onboarding: show a skippable wizard while core setup is
  // incomplete and the user hasn't dismissed it yet.
  const { dismissed: onboardingDismissed, dismiss: dismissOnboarding } =
    useOnboarding();
  // Ollama is left out on purpose: it is optional (summaries, titles and
  // tasks), and a skipped Ollama step must not bring the wizard back.
  const setupIncomplete =
    !loadedModel ||
    (micAvailable && !micPermission) ||
    (systemAudioSupported && !systemAudioPermission);
  // Only evaluate setup once every source has actually reported, so a
  // fully-configured user never sees the wizard flash while status loads:
  // Whisper models refreshed, Ollama status fetched, permissions checked.
  const setupChecked = whisperChecked && ollamaStatus !== null && !systemLoading;
  const showOnboarding =
    onboardingDismissed === false && setupChecked && setupIncomplete;

  const { profile } = useProfile();
  const theme = useThemeStore((state) => state.theme);
  const loadTheme = useThemeStore((state) => state.loadTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const { tags, selectedTag, fetchTags, selectTag, getTagsForNote } = useTagsStore();

  // Load theme from database on mount
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  // Refresh tags when notes change
  useEffect(() => {
    fetchTags();
  }, [notes, fetchTags]);

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

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"notes" | "graph" | "tasks">(
    "notes"
  );
  // Bumped after note edits so the global Tasks view reloads.
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  // When navigating from the global Tasks view, the task to focus in the note.
  const setFocusTaskId = useNoteUiStore((s) => s.setFocusTaskId);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    | "profile"
    | "appearance"
    | "system"
    | "whisper"
    | "ollama"
    | "privacy"
    | "shortcuts"
    | "about"
    | "updates"
    | "disclaimer"
    | "guide"
  >("about");
  const [noteTranscripts, setNoteTranscripts] = useState<
    Record<string, TranscriptSegment[]>
  >({});
  // App only switches tabs (on record / graph / Tasks navigation); NoteView
  // reads the active tab from the store and drives the tab bar itself.
  const setActiveTab = useNoteUiStore((s) => s.setActiveTab);
  const setEditingTitle = useNoteUiStore((s) => s.setEditingTitle);
  const [, setEditingDescription] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  // Which note is recording lives in the recording store so NoteView can scope
  // its own recording UI without App threading it down.
  const recordingNoteId = useRecordingStore((s) => s.recordingNoteId);
  const setRecordingNoteId = useRecordingStore((s) => s.setRecordingNoteId);
  // True while the post-stop auto-retranscribe pass is running. Shown as a
  // banner above the transcript so the user knows work is happening between
  // "stop" and the final, higher-quality transcript appearing.
  // App only writes this; NoteView reads it from the store to scope its banner.
  const setRetranscribingNoteId = useLiveTranscriptionStore(
    (s) => s.setRetranscribingNoteId
  );
  const isGeneratingSummaryTitle = useSummaryUiStore((s) => s.isGeneratingTitle);
  const setIsGeneratingSummaryTitle = useSummaryUiStore(
    (s) => s.setGeneratingTitle
  );
  const bumpSummariesRefreshKey = useSummaryUiStore((s) => s.bumpRefreshKey);
  const toggleAISidebar = useNoteUiStore((s) => s.toggleAISidebar);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "note" | "general";
    noteId?: string;
  } | null>(null);

  // Search and tag filtering state
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredNotesByTag, setFilteredNotesByTag] = useState<Note[] | null>(null);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) || null;
  const recordingNote = notes.find((n) => n.id === recordingNoteId) || null;
  // note_id -> title, for the central Tasks page.
  const noteTitles = useMemo(
    () => Object.fromEntries(notes.map((n) => [n.id, n.title])),
    [notes]
  );

  // Filter notes by search query and tag
  const displayNotes = useMemo(() => {
    let filtered = filteredNotesByTag !== null ? filteredNotesByTag : notes;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (note) =>
          note.title.toLowerCase().includes(query) ||
          note.description?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [notes, filteredNotesByTag, searchQuery]);

  // Handle tag selection
  const handleTagSelect = useCallback(async (tagName: string | null) => {
    selectTag(tagName);
    if (tagName) {
      try {
        const filtered = await tagsApi.getNotesByTag(tagName);
        setFilteredNotesByTag(filtered);
      } catch (error) {
        console.error("Failed to filter notes by tag:", error);
        setFilteredNotesByTag(null);
      }
    } else {
      setFilteredNotesByTag(null);
    }
  }, [selectTag]);
  // Load a note's transcript the first time it is opened, however it was opened:
  // the sidebar, Cmd+K, a link, the graph or the Tasks page. Only the sidebar
  // used to load it, so notes opened any other way showed an empty transcript.
  // Empty results are cached too, so a note without one isn't refetched.
  const noteTranscriptsRef = useRef(noteTranscripts);
  useEffect(() => {
    noteTranscriptsRef.current = noteTranscripts;
  }, [noteTranscripts]);
  useEffect(() => {
    if (!selectedNoteId || noteTranscriptsRef.current[selectedNoteId]) return;
    const noteId = selectedNoteId;
    let cancelled = false;
    loadTranscript(noteId).then((segments) => {
      if (cancelled || noteTranscriptsRef.current[noteId]) return;
      setNoteTranscripts((prev) => ({ ...prev, [noteId]: segments }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedNoteId, loadTranscript]);

  // Show live segments during recording or when paused, otherwise show saved transcript
  const currentTranscript = selectedNoteId
    ? (isLiveTranscribing || isPaused) && recordingNoteId === selectedNoteId
      ? liveSegments
      : noteTranscripts[selectedNoteId] || []
    : [];

  // Group notes by date
  const groupedNotes = useMemo(() => {
    const groups: { label: string; notes: Note[] }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayNotes: Note[] = [];
    const olderGroups: Map<string, Note[]> = new Map();

    displayNotes.forEach((note) => {
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
  }, [displayNotes]);

  const handleNewNote = useCallback(async () => {
    const note = await createNote("Untitled");
    setSelectedNoteId(note.id);
    // Open it where it can be typed in, even from the Graph or Tasks view.
    setCurrentView("notes");
    setActiveTab("note");
    setFocusTaskId(null);
  }, [createNote, setActiveTab, setFocusTaskId]);

  const handleStartRecording = useCallback(async () => {
    // Refresh and check that *some* audio input (mic or system audio) is available.
    const status = await refreshSystemStatus();
    const canMic = status.micAvailable && status.micPermission;
    const canSystem =
      status.systemAudioSupported && status.systemAudioPermission;
    if (!canMic && !canSystem) {
      setSettingsTab("system");
      setShowSettings(true);
      return;
    }

    const note = await createNote("Untitled");
    try {
      await startRecording(note.id);
    } catch (error) {
      // Nothing was recorded (another session is running, or capture failed):
      // don't leave an empty note behind.
      console.error("Start recording failed:", error);
      await deleteNote(note.id).catch(console.error);
      return;
    }
    setSelectedNoteId(note.id);
    // Only now: pointing the recording UI at the note before the start
    // succeeded is how a failed start used to take over a running session.
    setRecordingNoteId(note.id);
    // Recording answers any meeting prompt; don't bring it back after Stop.
    useMeetingStore.getState().dismissMeeting();
    // Show the recording (and its Stop control) even from Graph or Tasks.
    setCurrentView("notes");
    setActiveTab("transcript");
    // Live transcription handles both mic and system-audio buffers; safe in listen-only mode.
    await startLiveTranscription(note.id, profile.name || "Me");
  }, [
    createNote,
    deleteNote,
    startRecording,
    startLiveTranscription,
    profile.name,
    refreshSystemStatus,
    setRecordingNoteId,
    setActiveTab,
  ]);

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

  // Keyboard shortcut: Cmd/Ctrl + K for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Ollama is often started after Note67, or restarted. Re-check while it is
  // down (on window focus and every 15 s) and stop once it is up.
  useEffect(() => {
    if (ollamaRunning) return;
    const intervalId = window.setInterval(() => void checkOllamaStatus(), 15_000);
    const onFocus = () => void checkOllamaStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [ollamaRunning, checkOllamaStatus]);

  // A session is open while recording or paused; only one may exist.
  const recordingSessionActive = isRecording || isPaused;

  // Start recording from a shortcut or the meeting prompt. Recording needs a
  // Whisper model and an audio input, nothing else: Ollama is only for the
  // summary afterwards, and requiring it here meant users without it could
  // not record at all. Without a model, open the settings that fix that
  // instead of silently doing nothing.
  const requestRecording = useCallback(() => {
    if (recordingSessionActive) return;
    if (!loadedModel) {
      setSettingsTab("whisper");
      setShowSettings(true);
      return;
    }
    handleStartRecording();
  }, [recordingSessionActive, loadedModel, handleStartRecording]);

  // Keyboard shortcut: Cmd/Ctrl + R for new note and start recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        requestRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestRecording]);

  // Listen for tray "New Note" event
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let mounted = true;

    listen("tray-new-note", () => {
      // Record into a new note when that's possible, otherwise just create one.
      if (!recordingSessionActive && loadedModel) {
        handleStartRecording();
      } else {
        handleNewNote();
      }
    }).then((fn) => {
      if (mounted) {
        unlistenFn = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, [recordingSessionActive, loadedModel, handleStartRecording, handleNewNote]);

  // Listen for tray "Settings" event
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let mounted = true;

    listen("tray-open-settings", () => {
      setSettingsTab("about");
      setShowSettings(true);
    }).then((fn) => {
      if (mounted) {
        unlistenFn = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlistenFn?.();
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
        } else if (currentView === "graph") {
          setCurrentView("notes");
        } else if (currentView === "tasks") {
          // Central Tasks page (with no task selected) → back home.
          setCurrentView("notes");
        } else if (selectedNoteId) {
          setSelectedNoteId(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    contextMenu,
    showDeleteConfirm,
    showSettings,
    currentView,
    selectedNoteId,
    refreshSystemStatus,
  ]);

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

  // Keyboard shortcut: Cmd/Ctrl + J to toggle AI sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        if (selectedNoteId) {
          toggleAISidebar();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNoteId, toggleAISidebar]);

  // Global right-click handler - prevent default and show custom menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Text fields and the note editor keep the native menu: cut, copy,
      // paste and spelling suggestions.
      if (target.isContentEditable || target.closest("input, textarea, .ProseMirror")) {
        setContextMenu(null);
        return;
      }
      e.preventDefault();
      // Check if clicking on a note item or task row (handled separately)
      if (target.closest("[data-note-id]") || target.closest("[data-task-context]")) {
        return; // Let the item-specific handler deal with it
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
      // The summary reads the notes from the database; save what was typed.
      await flushPendingNoteSave();
      // Save segments before stopping (to avoid stale closure)
      const segmentsToSave = [...liveSegments];
      const audioPath = await stopRecording();
      // Stop live transcription and save segments to database
      await stopLiveTranscription(noteId);
      await endNote(noteId, audioPath ?? undefined);

      // Show live transcript immediately while retranscription runs
      let transcriptToUse = segmentsToSave;
      const savedSegments = await loadTranscript(noteId);
      if (savedSegments.length > 0) {
        transcriptToUse = savedSegments;
      }
      if (transcriptToUse.length > 0) {
        setNoteTranscripts((prev) => ({
          ...prev,
          [noteId]: transcriptToUse,
        }));
      }
      setRecordingNoteId(null);

      // Always refresh notes to update ended_at
      await refreshNotes();

      // Auto-retranscribe for better quality (runs in background)
      if (loadedModel) {
        console.log("[handleStopRecording] Starting auto-retranscribe for better quality");
        setRetranscribingNoteId(noteId);
        try {
          await transcriptionApi.retranscribeNote(noteId);
          // Reload transcript with improved results
          const improvedSegments = await loadTranscript(noteId);
          if (improvedSegments.length > 0) {
            transcriptToUse = improvedSegments;
            setNoteTranscripts((prev) => ({
              ...prev,
              [noteId]: improvedSegments,
            }));
          }
          console.log("[handleStopRecording] Auto-retranscribe complete, segments:", improvedSegments.length);
        } catch (error) {
          console.error("Auto-retranscribe failed:", error);
          // Continue with live transcript if retranscribe fails
        } finally {
          setRetranscribingNoteId(null);
        }
      }

      // Ask Ollama now rather than trusting cached status: it may have been
      // started, stopped or restarted during the meeting. Without it, the
      // transcript is the result, and the Summary tab says how to get more.
      const ai = await aiApi.getOllamaStatus().catch(() => null);
      const aiReady = Boolean(ai?.running && ai.selected_model);
      if (!aiReady) {
        void checkOllamaStatus();
        if (transcriptToUse.length > 0) setActiveTab("transcript");
      }

      // Auto-generate summary and title if we have transcript
      if (aiReady && transcriptToUse.length > 0) {
        setActiveTab("summary");
        setIsGeneratingSummaryTitle(true);
        try {
          // Notes may have been typed while the transcript was being rebuilt.
          await flushPendingNoteSave();
          // Generate overview summary first
          const summary = await aiApi.generateSummary(noteId, "overview");
          // Trigger summaries refresh in NoteView
          bumpSummariesRefreshKey();
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

  // Keyboard shortcut: Cmd/Ctrl + S to stop recording.
  // Keep a ref to the latest handler so the listener can be bound once (the
  // handler itself no-ops when nothing is recording).
  const handleStopRecordingRef = useRef(handleStopRecording);
  useEffect(() => {
    handleStopRecordingRef.current = handleStopRecording;
  });
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleStopRecordingRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Resume a paused recording. Shared by the note's Resume button and the
  // floating pill: the pill used to resume without checking inputs and
  // restarted live transcription with no segments and no speaker name, which
  // wiped the pre-pause lines off the screen and relabelled the mic "Me".
  const handleResumeRecording = async () => {
    try {
      // At least one audio input (mic or system audio) must be available.
      const status = await refreshSystemStatus();
      const canMic = status.micAvailable && status.micPermission;
      const canSystem =
        status.systemAudioSupported && status.systemAudioPermission;
      if (!canMic && !canSystem) {
        setSettingsTab("system");
        setShowSettings(true);
        return;
      }

      if (recordingNoteId) {
        await resumeRecording(recordingNoteId);
        await startLiveTranscription(
          recordingNoteId,
          profile?.name || "Me",
          liveSegments
        );
      }
    } catch (error) {
      console.error("Resume recording failed:", error);
    }
  };

  // Regenerate summary and title for the selected note
  const handleRegenerateSummaryTitle = async () => {
    if (!selectedNoteId) return;

    setIsGeneratingSummaryTitle(true);
    try {
      await flushPendingNoteSave();
      // Generate overview summary first
      const summary = await aiApi.generateSummary(selectedNoteId, "overview");
      // Trigger summaries refresh in NoteView
      bumpSummariesRefreshKey();
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

  // Stable so NoteView's debounced effects don't reset on every App render.
  const handleTasksChanged = useCallback(
    () => setTasksRefreshKey((k) => k + 1),
    []
  );

  const handleSelectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setCurrentView("notes"); // Exit graph view when selecting a note
    setActiveTab("summary");
    setFocusTaskId(null);
  };

  const handleUpdateTitle = async (title: string) => {
    if (selectedNote && title.trim()) {
      await updateNote(selectedNote.id, { title: title.trim() });
      // Refresh all notes since linked notes may have been updated
      await refreshNotes();
    }
    setEditingTitle(false);
  };

  const handleUpdateDescription = async (description: string) => {
    if (selectedNote) {
      // Sent as-is: an empty string clears the body. `undefined` means
      // "unchanged" to update_note, so a cleared note used to keep its text.
      await updateNote(selectedNote.id, { description });
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentView("notes")}
              className={`px-2 py-1 text-sm font-medium rounded transition-colors ${
                currentView === "notes"
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              Notes
            </button>
            <button
              onClick={() => setCurrentView("tasks")}
              className={`px-2 py-1 text-sm font-medium rounded transition-colors ${
                currentView === "tasks"
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setCurrentView("graph")}
              className={`px-2 py-1 text-sm font-medium rounded transition-colors ${
                currentView === "graph"
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              }`}
              title="Graph View"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="6" cy="6" r="2.5" strokeWidth="1.5" />
                <circle cx="18" cy="6" r="2.5" strokeWidth="1.5" />
                <circle cx="6" cy="18" r="2.5" strokeWidth="1.5" />
                <circle cx="18" cy="18" r="2.5" strokeWidth="1.5" />
                <path strokeWidth="1.5" d="M8.5 6h7M6 8.5v7M18 8.5v7M8.5 18h7" />
              </svg>
            </button>
          </div>
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

        {/* Search with Tag Filter */}
        <NoteSearchWithTags
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tags={tags}
          selectedTag={selectedTag}
          onTagSelect={handleTagSelect}
        />

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
                      className="text-xs flex items-center gap-1.5"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <span>{formatTime(note.started_at)}</span>
                      {isRecording && recordingNoteId === note.id && (
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: "var(--color-accent-light)",
                            color: "var(--color-accent)",
                          }}
                        >
                          Live
                        </span>
                      )}
                    </div>
                    {getTagsForNote(note.id).length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {getTagsForNote(note.id).slice(0, 4).map((tag) => {
                          const tagColor = getTagColor(tag.name);
                          return (
                            <span
                              key={tag.id}
                              className="flex items-center gap-1 text-[10px]"
                              style={{ color: "var(--color-text-tertiary)" }}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: tagColor }}
                              />
                              {tag.name}
                            </span>
                          );
                        })}
                        {getTagsForNote(note.id).length > 4 && (
                          <span
                            className="text-[10px]"
                            style={{ color: "var(--color-text-tertiary)" }}
                          >
                            +{getTagsForNote(note.id).length - 4}
                          </span>
                        )}
                      </div>
                    )}
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
                backgroundColor: profile.avatar
                  ? "var(--color-accent-light)"
                  : "var(--color-sidebar-hover)",
                color: profile.avatar
                  ? "var(--color-text)"
                  : "var(--color-text-secondary)",
              }}
            >
              {profile.avatar ||
                (profile.name ? profile.name[0].toUpperCase() : "?")}
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
              {(!profile.name ||
                !loadedModel ||
                !ollamaRunning ||
                !ollamaModel ||
                updateAvailable ||
                systemNeedsSetup) && (
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
        {currentView === "graph" && (
          <Suspense
            fallback={
              <div
                className="flex-1 flex items-center justify-center text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Loading graph…
              </div>
            }
          >
            <GraphView
              onSelectNote={(noteId) => {
                setSelectedNoteId(noteId);
                setCurrentView("notes");
                setActiveTab("note");
              }}
            />
          </Suspense>
        )}
        {currentView === "tasks" && (
          <TasksView
            refreshKey={tasksRefreshKey}
            noteTitles={noteTitles}
            onOpenInNote={(noteId, taskId) => {
              const target = notes.find((n) => n.id === noteId);
              if (target) {
                setSelectedNoteId(target.id);
                setCurrentView("notes");
                setActiveTab("tasks");
                setFocusTaskId(taskId);
              }
            }}
          />
        )}
        {currentView === "notes" && selectedNote ? (
          <NoteView
            key={selectedNote.id}
            note={selectedNote}
            transcript={currentTranscript}
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
            onResumeRecording={handleResumeRecording}
            onContinueRecording={async () => {
              try {
                // At least one audio input (mic or system audio) must be available.
                const status = await refreshSystemStatus();
                const canMic =
                  status.micAvailable && status.micPermission;
                const canSystem =
                  status.systemAudioSupported && status.systemAudioPermission;
                if (!canMic && !canSystem) {
                  setSettingsTab("system");
                  setShowSettings(true);
                  return;
                }

                // Load existing transcripts before starting
                const existingSegments = await loadTranscript(selectedNote.id);
                await continueRecording(selectedNote.id);
                // Only after the start succeeded (see handleStartRecording).
                setRecordingNoteId(selectedNote.id);
                await startLiveTranscription(
                  selectedNote.id,
                  profile?.name || "Me",
                  existingSegments
                );
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
            onAudioChanged={refreshNotes}
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
            onNavigateToNote={(noteId) => {
              const targetNote = notes.find(n => n.id === noteId);
              if (targetNote) {
                setSelectedNoteId(targetNote.id);
                setActiveTab("note");
              }
            }}
            onWikiLinkClick={(title) => {
              const targetNote = notes.find(n =>
                n.title.toLowerCase() === title.toLowerCase()
              );
              if (targetNote) {
                setSelectedNoteId(targetNote.id);
                setActiveTab("note");
              }
            }}
            onOpenGuide={() => {
              setSettingsTab("guide");
              setShowSettings(true);
            }}
            onTasksChanged={handleTasksChanged}
          />
        ) : currentView === "notes" ? (
          <EmptyState
            needsSetup={!loadedModel}
            onOpenSettings={() => {
              setSettingsTab("whisper");
              setShowSettings(true);
            }}
          />
        ) : null}

        {/* Start Listening Button, Recording Indicator, or Generating Indicator */}
        {/* Hide when viewing a note (unless recording or generating) or in graph view */}
        {currentView === "notes" && !(selectedNote && !isRecording && !isGeneratingSummaryTitle) && (
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
                  onClick={handleResumeRecording}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm shadow-md transition-transform hover:scale-105"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
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
                  <kbd
                    className="font-medium"
                    style={{ color: "var(--color-text)" }}
                  >
                    {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} + S
                  </kbd>{" "}
                  to stop
                </span>
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                disabled={!loadedModel}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm shadow-md transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 hover:scale-105"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
                title={
                  !loadedModel
                    ? "Load a transcription model in Settings first"
                    : undefined
                }
              >
                <span className="w-2 h-2 rounded-full bg-white" />
                Start listening
              </button>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      {showSettings && (
        <Settings
          onClose={() => {
            setShowSettings(false);
            refreshSystemStatus();
          }}
          initialTab={settingsTab}
          onTabChange={setSettingsTab}
        />
      )}

      {/* Search Modal */}
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onSelectNote={(noteId) => {
          // Same as a sidebar click, so a result opened from Graph or Tasks
          // is actually shown.
          const note = notes.find((n) => n.id === noteId);
          if (note) handleSelectNote(note);
        }}
      />

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
      {/* Hidden while a session is open: starting another would be refused. */}
      {!recordingSessionActive && (
        <MeetingDetectedPopup onStartListening={requestRecording} />
      )}

      {/* First-run onboarding wizard */}
      {showOnboarding && (
        <OnboardingWizard
          onDismiss={dismissOnboarding}
          onStatusChange={refreshSystemStatus}
        />
      )}
    </div>
  );
}



export default App;
