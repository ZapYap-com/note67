import { useState, useEffect, useCallback, useRef } from "react";
import {
  SummaryPanel,
  TranscriptSearch,
  AudioPlayer,
  MarkdownEditor,
  AISidebar,
  BacklinksPanel,
  ActionsTab,
} from "./index";
import { exportApi, notesApi, transcriptionApi } from "../api";
import { useSummaries, useUploadedAudio, useAIWriting, useNoteBodySave } from "../hooks";
import { useOllamaStore } from "../stores/ollamaStore";
import { useWhisperStore } from "../stores/whisperStore";
import { useRecordingStore } from "../stores/recordingStore";
import { useLiveTranscriptionStore } from "../stores/liveTranscriptionStore";
import { useSummaryUiStore } from "../stores/summaryUiStore";
import { useNoteUiStore } from "../stores/noteUiStore";
import type { Note, TranscriptSegment, AudioSegment } from "../types";
import { RecordingPhase } from "../types";

export interface NoteViewProps {
  note: Note;
  transcript: TranscriptSegment[];
  onUpdateTitle: (title: string) => void;
  onUpdateDescription: (desc: string) => void | Promise<void>;
  onStopRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onContinueRecording: () => void;
  onDelete: () => void;
  onExport: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  onTranscriptUpdated?: () => void;
  // The note's playback track was rebuilt under a new path; refetch the note.
  onAudioChanged?: () => void;
  // Backlinks navigation
  onNavigateToNote?: (noteId: string) => void;
  // Wiki link navigation
  onWikiLinkClick?: (noteTitle: string) => void;
  // Help
  onOpenGuide?: () => void;
  // #3: notify the parent to refresh the global Tasks view after edits.
  onTasksChanged?: () => void;
}

export function NoteView({
  note,
  transcript,
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
  onAudioChanged,
  onNavigateToNote,
  onWikiLinkClick,
  onOpenGuide,
  onTasksChanged,
}: NoteViewProps) {
  // Read straight from the stores rather than taking these as props — they are
  // already global state, so threading them through App.tsx bought nothing.
  //
  // Recording state is global but this UI is per-note, so isRecording/isPaused
  // are scoped to *this* note. Reading the raw flags would light up the
  // recording UI on every note, not just the one being recorded.
  const isThisNoteRecording =
    useRecordingStore((s) => s.recordingNoteId) === note.id;
  const isRecording =
    useRecordingStore((s) => s.isRecording) && isThisNoteRecording;
  const isPaused = useRecordingStore((s) => s.isPaused) && isThisNoteRecording;
  // Any session, on any note, recording or paused. Starting another recording
  // while one is open is refused by the backend; the button shouldn't offer it.
  const isSessionActive = useRecordingStore(
    (s) => s.isRecording || s.isPaused || s.recordingPhase !== RecordingPhase.Idle
  );
  const audioLevel = useRecordingStore((s) => s.audioLevel);
  const recordingMode = useRecordingStore((s) => s.recordingMode);

  // Live transcription is scoped to the recording note, same as above.
  const isTranscribing =
    useLiveTranscriptionStore((s) => s.isLiveTranscribing) && isThisNoteRecording;
  const isAutoRetranscribing =
    useLiveTranscriptionStore((s) => s.retranscribingNoteId) === note.id;

  const isRegenerating = useSummaryUiStore((s) => s.isGeneratingTitle);
  const summariesRefreshKey = useSummaryUiStore((s) => s.refreshKey);

  // Note-pane view state. App also drives these (switching tabs when a
  // recording starts, or when navigating in from the graph/Tasks views), so
  // they live in a store rather than being passed down with a setter each.
  const activeTab = useNoteUiStore((s) => s.activeTab);
  const onTabChange = useNoteUiStore((s) => s.setActiveTab);
  const editingTitle = useNoteUiStore((s) => s.editingTitle);
  const setEditingTitle = useNoteUiStore((s) => s.setEditingTitle);
  const showAISidebar = useNoteUiStore((s) => s.showAISidebar);
  const onToggleAISidebar = useNoteUiStore((s) => s.toggleAISidebar);
  const focusTaskId = useNoteUiStore((s) => s.focusTaskId);

  const ollamaStatus = useOllamaStore((s) => s.status);
  const ollamaRunning = ollamaStatus?.running ?? false;
  const hasOllamaModel = Boolean(ollamaStatus?.selected_model);
  const loadedModel = useWhisperStore((s) => s.loadedModel);

  const [titleValue, setTitleValue] = useState(note.title);
  const [descValue, setDescValue] = useState(note.description || "");
  const [playingAudioPath, setPlayingAudioPath] = useState<string | null>(
    note.audio_path || null
  );
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<{
    play: () => void;
    pause: () => void;
    toggle: () => void;
  } | null>(null);

  // AI Writing hook
  const {
    isGenerating: isAIGenerating,
    streamingContent: aiStreamingContent,
    generate: generateAI,
  } = useAIWriting();

  // Clean AI output - strip code blocks and fix formatting
  const cleanAIOutput = useCallback((text: string) => {
    let cleaned = text;
    // Remove code block markers
    cleaned = cleaned.replace(/^```[\w]*\n?/gm, '');
    cleaned = cleaned.replace(/```$/gm, '');
    // Remove leading spaces from each line (prevents code block in editor)
    cleaned = cleaned.split('\n').map(line => line.trimStart()).join('\n');
    // Fix double dashes to single dash for bullets
    cleaned = cleaned.replace(/^--\s*/gm, '- ');
    cleaned = cleaned.replace(/^\s+--\s*/gm, '  - ');
    // Remove orphan asterisks at start of lines (****text -> text)
    cleaned = cleaned.replace(/^\*{3,}/gm, '');
    // Fix "** text" (space after **) - remove the asterisks
    cleaned = cleaned.replace(/\*\*\s+/g, '');
    // Remove trailing orphan asterisks
    cleaned = cleaned.replace(/\*{2,}$/gm, '');
    // Fix double colons
    cleaned = cleaned.replace(/::/g, ':');
    // Remove duplicate consecutive words
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');
    return cleaned.trim();
  }, []);

  // Handle AI text insertion
  const handleAIInsert = useCallback((text: string) => {
    const cleaned = cleanAIOutput(text);
    setDescValue((prev) => prev + "\n\n" + cleaned);
  }, [cleanAIOutput]);

  // Handle AI text replacement
  const handleAIReplace = useCallback((text: string) => {
    const cleaned = cleanAIOutput(text);
    setDescValue(cleaned);
  }, [cleanAIOutput]);

  // Handle AI generation
  const handleAIGenerate = useCallback((content: string, action: string) => {
    generateAI(content, action, descValue);
  }, [generateAI, descValue]);

  // Handle after AI insert/replace - switch to notes tab
  const handleAIInserted = useCallback(() => {
    onTabChange("note");
  }, [onTabChange]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMoreMenu]);

  // Reset the playing audio path when the note's audio changes (don't auto-play).
  // Done during render (not an effect) to avoid a synchronous setState in an
  // effect; only runs when note.audio_path actually changes.
  const [prevAudioPath, setPrevAudioPath] = useState(note.audio_path);
  if (note.audio_path !== prevAudioPath) {
    setPrevAudioPath(note.audio_path);
    setPlayingAudioPath(note.audio_path || null);
    setShouldAutoPlay(false);
  }

  // The note body is saved 1.5 s after typing stops, on blur, and on demand
  // before anything reads it back from the database (flushPendingNoteSave).
  const saveDescription = useNoteBodySave(
    descValue,
    note.description || "",
    onUpdateDescription
  );

  const setFlushNoteSave = useNoteUiStore((s) => s.setFlushNoteSave);
  useEffect(() => {
    setFlushNoteSave(saveDescription);
    return () => {
      // Only clear our own registration, never the next note's.
      if (useNoteUiStore.getState().flushNoteSave === saveDescription) {
        setFlushNoteSave(null);
      }
    };
  }, [saveDescription, setFlushNoteSave]);

  // Handle play request from audio files list
  const handlePlayAudio = useCallback(
    (path: string) => {
      if (path === playingAudioPath) {
        // Toggle play/pause for current file
        audioPlayerRef.current?.toggle();
      } else {
        // Switch to new file and play
        setPlayingAudioPath(path);
        setShouldAutoPlay(true);
      }
    },
    [playingAudioPath]
  );

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

  // Load audio segments when note changes or recording stops (migrate legacy audio first)
  useEffect(() => {
    const loadSegments = async () => {
      // Migrate legacy audio_path to audio_segments if needed
      const migrated = await notesApi
        .migrateLegacyAudio(note.id)
        .catch(() => null);
      // Then load segments
      const segments = await notesApi.getAudioSegments(note.id);
      setAudioSegments(segments);
      // If migration happened, set the playing path to the migrated segment.
      // Listen-only segments have mic_path === null, so fall back to system_path.
      if (migrated) {
        setPlayingAudioPath(migrated.mic_path ?? migrated.system_path);
      } else if (segments.length > 0) {
        // Only pick a default when nothing is playing yet — done via the
        // functional updater so we don't need playingAudioPath as a dependency.
        const first = segments[0];
        setPlayingAudioPath((current) => current ?? (first.mic_path ?? first.system_path));
      }
    };
    loadSegments().catch(console.error);
  }, [note.id, isRecording]); // Also refresh when recording state changes

  // Refresh both audio segments and uploads after reordering
  const handleAudioReorder = useCallback(() => {
    notesApi
      .getAudioSegments(note.id)
      .then(setAudioSegments)
      .catch(console.error);
    loadUploads();
  }, [note.id, loadUploads]);

  // Retranscribe state and handlers
  const [isRetranscribing, setIsRetranscribing] = useState(false);

  const handleRetranscribeAll = useCallback(async () => {
    if (isRetranscribing) return;
    setIsRetranscribing(true);
    // Switch to transcript tab to show progress
    onTabChange("transcript");
    try {
      console.log("Starting retranscribe for note:", note.id);
      console.log("Audio segments:", audioSegments);
      console.log("Uploads:", uploads);
      const result = await transcriptionApi.retranscribeNote(note.id);
      console.log("Retranscribe result:", result);
      // Refresh transcripts
      onTranscriptUpdated?.();
    } catch (error) {
      console.error("Retranscribe failed:", error);
    } finally {
      setIsRetranscribing(false);
    }
  }, [note.id, isRetranscribing, onTranscriptUpdated, onTabChange, audioSegments, uploads]);

  // Set titleValue to current note.title when entering edit mode
  const handleEditTitle = () => {
    setTitleValue(note.title);
    setEditingTitle(true);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main content */}
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
                <svg
                  className="w-3.5 h-3.5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                Pause
              </button>
              <button
                onClick={onStopRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full font-medium"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
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
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
                title="Resume recording"
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
          {/* Ended/idle note controls - show Listen when no session is open and nothing is generating */}
          {!isSessionActive && !isRegenerating && !isGenerating && (
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
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                Record
              </button>
              {/* Retranscribe All button - show when model loaded and there are audio files */}
              {loadedModel && (audioSegments.length > 0 || uploads.length > 0) && (
                <button
                  onClick={handleRetranscribeAll}
                  disabled={isRetranscribing || isTranscribingUpload}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full font-medium disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                  }}
                  title="Retranscribe all audio with current model"
                >
                  {isRetranscribing ? (
                    <div
                      className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                      style={{
                        borderColor: "var(--color-text-secondary)",
                        borderTopColor: "transparent",
                      }}
                    />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {isRetranscribing ? "Retranscribing..." : "Retranscribe"}
                </button>
              )}
            </>
          )}
          {/* Generate/Regenerate button */}
          {!isRecording &&
            !isTranscribing &&
            !isGenerating &&
            !isRegenerating &&
            (transcript.length > 0 || descValue.trim().length > 0) &&
            hasOllamaModel &&
            ollamaRunning && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full font-medium"
                style={{
                  backgroundColor: "#374151",
                  color: "white",
                }}
                title="Summarize"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
                Summarize
              </button>
            )}
          {/* AI Assistant toggle */}
          {!isRecording && !isPaused && ollamaRunning && hasOllamaModel && (
            <button
              onClick={onToggleAISidebar}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full font-medium transition-colors"
              style={{
                backgroundColor: showAISidebar ? "var(--color-accent)" : "var(--color-bg-elevated)",
                border: showAISidebar ? "none" : "1px solid var(--color-border)",
                color: showAISidebar ? "white" : "var(--color-text)",
              }}
              title="AI Assistant (⌘J)"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                />
              </svg>
              AI
            </button>
          )}
          {/* More menu */}
          {!isRecording && !isPaused && (
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-1.5 rounded-md hover:bg-black/5"
                title="More actions"
              >
                <svg
                  className="w-4 h-4"
                  style={{ color: "var(--color-text-secondary)" }}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {showMoreMenu && (
                <div
                  className="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg min-w-[140px] z-50"
                  style={{
                    backgroundColor: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <button
                    onClick={() => {
                      uploadAudio();
                      setShowMoreMenu(false);
                    }}
                    disabled={isUploading}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-black/5 flex items-center gap-2 disabled:opacity-50"
                    style={{ color: "var(--color-text)" }}
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
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    )}
                    Upload Audio
                  </button>
                  <button
                    onClick={() => {
                      onExport();
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-black/5 flex items-center gap-2"
                    style={{ color: "var(--color-text)" }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export Note
                  </button>
                  <button
                    onClick={() => {
                      onOpenGuide?.();
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-black/5 flex items-center gap-2"
                    style={{ color: "var(--color-text)" }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Note Guide
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
                  <button
                    onClick={() => {
                      onDelete();
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-black/5 flex items-center gap-2"
                    style={{ color: "var(--color-accent)" }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </div>
              )}
            </div>
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
            title={
              recordingMode === "system-only"
                ? "Microphone is off — capturing system audio only. Your voice will not be recorded."
                : undefined
            }
          >
            {recordingMode === "system-only"
              ? "Listening (system audio only)"
              : "Recording"}
          </span>
          {recordingMode !== "system-only" && (
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
          )}
        </div>
      )}

      {/* Paused indicator */}
      {isPaused && (
        <div
          className="px-6 py-2 flex items-center gap-2"
          style={{ backgroundColor: "var(--color-bg-elevated)" }}
        >
          <svg
            className="w-3 h-3"
            fill="var(--color-text-secondary)"
            viewBox="0 0 24 24"
          >
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
        {(["note", "tasks", "transcript", "summary"] as const).map((tab) => (
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
        {activeTab === "note" && (
          <div className="h-full flex flex-col">
            <MarkdownEditor
              value={descValue}
              onChange={setDescValue}
              onBlur={() => void saveDescription()}
              placeholder="Take notes or press / for commands..."
              noteId={note.id}
              onWikiLinkClick={onWikiLinkClick}
              onNavigateToNote={onNavigateToNote}
            />
          </div>
        )}

        {activeTab === "transcript" && (
          <>
            {(isAutoRetranscribing || isRetranscribing) && (
              <div
                className="mb-3 px-3 py-2 rounded-lg flex items-center gap-2 text-xs"
                style={{
                  backgroundColor: "var(--color-accent-light)",
                  color: "var(--color-accent)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeOpacity="0.25"
                  />
                  <path
                    d="M22 12a10 10 0 0 0-10-10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Improving transcript quality…</span>
              </div>
            )}
            {transcript.length > 0 ? (
              <TranscriptSearch
                segments={transcript}
                audioSegments={audioSegments}
                uploads={uploads}
                isLive={isRecording}
              />
            ) : (
              <div
                className="text-center py-12 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {isAutoRetranscribing || isRetranscribing
                  ? "Transcribing recorded audio…"
                  : note.audio_path
                    ? "Transcribe this note to see the transcript"
                    : "No audio recorded"}
              </div>
            )}
          </>
        )}

        {activeTab === "summary" && (
          <SummaryPanel
            aiReady={ollamaRunning && hasOllamaModel}
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

        {activeTab === "tasks" && (
          <ActionsTab
            noteId={note.id}
            canUseAI={ollamaRunning && hasOllamaModel}
            onChanged={onTasksChanged}
            focusTaskId={focusTaskId}
          />
        )}
      </div>

      {/* Backlinks Panel - show linked references */}
      {activeTab === "note" && onNavigateToNote && (
        <BacklinksPanel
          noteId={note.id}
          onNavigate={onNavigateToNote}
        />
      )}

      {/* Audio Player - show when there's audio to play and not recording */}
      {!isRecording && playingAudioPath && (
        <AudioPlayer
          ref={audioPlayerRef}
          audioPath={playingAudioPath}
          title={note.title}
          autoPlay={shouldAutoPlay}
          onAutoPlayHandled={() => setShouldAutoPlay(false)}
          // Audio files list props
          uploads={uploads}
          segments={audioSegments}
          mainAudioPath={note.audio_path}
          isTranscribing={isTranscribingUpload}
          onTranscribe={async (uploadId) => {
            await transcribeUpload(uploadId);
            onTranscriptUpdated?.();
          }}
          onDeleteUpload={deleteUpload}
          onReorder={handleAudioReorder}
          onPlayAudio={handlePlayAudio}
          onPlaybackRebuilt={onAudioChanged}
        />
      )}
      </div>

      {/* AI Sidebar */}
      <AISidebar
        isOpen={showAISidebar}
        onClose={() => onToggleAISidebar?.()}
        noteContent={descValue}
        onInsert={handleAIInsert}
        onReplace={handleAIReplace}
        isGenerating={isAIGenerating}
        streamingContent={aiStreamingContent}
        onGenerate={handleAIGenerate}
        onInserted={handleAIInserted}
      />
    </div>
  );
}

