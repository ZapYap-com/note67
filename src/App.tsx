import { useState, useMemo } from "react";
import {
  ModelManager,
  OllamaSettings,
  SummaryPanel,
  TranscriptSearch,
} from "./components";
import { exportApi } from "./api";
import {
  useMeetings,
  useModels,
  useOllama,
  useRecording,
  useSummaries,
  useTranscription,
} from "./hooks";
import type {
  Meeting,
  SummaryType,
  TranscriptSegment,
  UpdateMeeting,
} from "./types";

function App() {
  const {
    meetings,
    loading,
    createMeeting,
    updateMeeting,
    endMeeting,
    deleteMeeting,
  } = useMeetings();
  const { isRecording, audioLevel, startRecording, stopRecording } =
    useRecording();
  const { loadedModel } = useModels();
  const { isTranscribing, transcript, transcribe, loadTranscript } =
    useTranscription();
  const { isRunning: ollamaRunning, selectedModel: ollamaModel } = useOllama();

  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null
  );
  const [showModelManager, setShowModelManager] = useState(false);
  const [showOllamaSettings, setShowOllamaSettings] = useState(false);
  const [meetingTranscripts, setMeetingTranscripts] = useState<
    Record<string, TranscriptSegment[]>
  >({});
  const [activeTab, setActiveTab] = useState<
    "notes" | "transcript" | "summary"
  >("notes");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

  const selectedMeeting =
    meetings.find((m) => m.id === selectedMeetingId) || null;
  const currentTranscript = selectedMeetingId
    ? meetingTranscripts[selectedMeetingId] || []
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

  const handleStartMeeting = async () => {
    const meeting = await createMeeting("Untitled");
    setSelectedMeetingId(meeting.id);
    await startRecording(meeting.id);
  };

  const handleStopRecording = async () => {
    if (selectedMeeting) {
      await stopRecording();
      await endMeeting(selectedMeeting.id);
    }
  };

  const handleTranscribe = async () => {
    if (!selectedMeeting?.audio_path || !loadedModel) return;
    const result = await transcribe(
      selectedMeeting.audio_path,
      selectedMeeting.id
    );
    if (result) {
      setMeetingTranscripts((prev) => ({
        ...prev,
        [selectedMeeting.id]: result.segments.map((s, idx) => ({
          id: idx,
          meeting_id: selectedMeeting.id,
          start_time: s.start_time,
          end_time: s.end_time,
          text: s.text,
          speaker: null,
          created_at: new Date().toISOString(),
        })),
      }));
      setActiveTab("transcript");
    }
  };

  const handleSelectMeeting = async (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    if (!meetingTranscripts[meeting.id]) {
      await loadTranscript(meeting.id);
      if (transcript.length > 0) {
        setMeetingTranscripts((prev) => ({
          ...prev,
          [meeting.id]: transcript,
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
        <div className="px-5 py-5 flex items-center justify-between">
          <span
            className="text-lg font-semibold"
            style={{ color: "var(--color-text)" }}
          >
            Meetings
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowOllamaSettings(true)}
              className="p-2 rounded-lg hover:bg-black/5 transition-colors"
              title="AI Settings"
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
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </button>
            <button
              onClick={() => setShowModelManager(true)}
              className="p-2 rounded-lg hover:bg-black/5 transition-colors"
              title="Whisper Models"
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Meeting List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div
              className="px-5 py-8 text-center"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Loading...
            </div>
          ) : groupedMeetings.length === 0 ? (
            <div
              className="px-5 py-12 text-center"
              style={{ color: "var(--color-text-secondary)" }}
            >
              No meetings yet
            </div>
          ) : (
            groupedMeetings.map((group) => (
              <div key={group.label} className="mb-2">
                <div
                  className="px-5 py-2 text-xs font-medium uppercase tracking-wider"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {group.label}
                </div>
                {group.meetings.map((meeting) => (
                  <button
                    key={meeting.id}
                    onClick={() => handleSelectMeeting(meeting)}
                    className="w-full px-5 py-3 text-left transition-colors"
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
                      className="font-medium truncate"
                      style={{ color: "var(--color-text)" }}
                    >
                      {meeting.title}
                    </div>
                    <div
                      className="text-sm mt-0.5"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {formatTime(meeting.started_at)}
                      {!meeting.ended_at && (
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
          className="px-4 py-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="flex flex-wrap items-center gap-2 text-xs"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {loadedModel && (
              <span
                className="px-2 py-1 rounded"
                style={{ backgroundColor: "var(--color-sidebar-hover)" }}
              >
                Whisper: {loadedModel}
              </span>
            )}
            {ollamaRunning && ollamaModel && (
              <span
                className="px-2 py-1 rounded"
                style={{ backgroundColor: "var(--color-sidebar-hover)" }}
              >
                AI: {ollamaModel.split(":")[0]}
              </span>
            )}
          </div>
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
            isRecording={isRecording && !selectedMeeting.ended_at}
            isTranscribing={isTranscribing}
            audioLevel={audioLevel}
            activeTab={activeTab}
            editingTitle={editingTitle}
            editingDescription={editingDescription}
            hasModel={!!loadedModel}
            ollamaRunning={ollamaRunning}
            hasOllamaModel={!!ollamaModel}
            onTabChange={setActiveTab}
            onEditTitle={() => setEditingTitle(true)}
            onEditDescription={() => setEditingDescription(true)}
            onUpdateTitle={handleUpdateTitle}
            onUpdateDescription={handleUpdateDescription}
            onStopRecording={handleStopRecording}
            onTranscribe={handleTranscribe}
            onDelete={() => {
              deleteMeeting(selectedMeeting.id);
              setSelectedMeetingId(null);
            }}
            onExport={async () => {
              const data = await exportApi.exportMarkdown(selectedMeeting.id);
              await exportApi.saveToFile(data.markdown, data.filename);
            }}
            onCopy={async () => {
              const data = await exportApi.exportMarkdown(selectedMeeting.id);
              await exportApi.copyToClipboard(data.markdown);
            }}
          />
        ) : (
          <EmptyState />
        )}

        {/* Start Listening Button */}
        {!isRecording && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
            <button
              onClick={handleStartMeeting}
              className="flex items-center gap-3 rounded-full font-normal text-sm shadow-lg transition-transform hover:scale-105"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                padding: "3px 6px",
              }}
            >
              <span
                className="rounded-full bg-white"
                style={{ width: "10px", height: "10px" }}
              />
              Start listening
            </button>
          </div>
        )}
      </main>

      {/* Modals */}
      {showModelManager && (
        <ModelManager onClose={() => setShowModelManager(false)} />
      )}
      {showOllamaSettings && (
        <OllamaSettings onClose={() => setShowOllamaSettings(false)} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center pb-24">
      <div className="text-center max-w-md px-8">
        <h2
          className="text-3xl font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Note67
        </h2>
        <p
          className="text-base leading-relaxed"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Select a meeting from the sidebar or start a new one
        </p>
      </div>
    </div>
  );
}

interface MeetingViewProps {
  meeting: Meeting;
  transcript: TranscriptSegment[];
  isRecording: boolean;
  isTranscribing: boolean;
  audioLevel: number;
  activeTab: "notes" | "transcript" | "summary";
  editingTitle: boolean;
  editingDescription: boolean;
  hasModel: boolean;
  ollamaRunning: boolean;
  hasOllamaModel: boolean;
  onTabChange: (tab: "notes" | "transcript" | "summary") => void;
  onEditTitle: () => void;
  onEditDescription: () => void;
  onUpdateTitle: (title: string) => void;
  onUpdateDescription: (desc: string) => void;
  onStopRecording: () => void;
  onTranscribe: () => void;
  onDelete: () => void;
  onExport: () => void;
  onCopy: () => void;
}

function MeetingView({
  meeting,
  transcript,
  isRecording,
  isTranscribing,
  audioLevel,
  activeTab,
  editingTitle,
  editingDescription,
  hasModel,
  ollamaRunning,
  hasOllamaModel,
  onTabChange,
  onEditTitle,
  onUpdateTitle,
  onUpdateDescription,
  onStopRecording,
  onTranscribe,
  onDelete,
  onExport,
  onCopy,
}: MeetingViewProps) {
  const [titleValue, setTitleValue] = useState(meeting.title);
  const [descValue, setDescValue] = useState(meeting.description || "");

  const { summaries, isGenerating, generateSummary, deleteSummary } =
    useSummaries(meeting.id);

  const canTranscribe =
    meeting.ended_at && meeting.audio_path && hasModel && !isTranscribing;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="px-8 py-6 border-b flex items-center justify-between"
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
              className="text-2xl font-semibold w-full"
              style={{ color: "var(--color-text)" }}
            />
          ) : (
            <h1
              onClick={onEditTitle}
              className="text-2xl font-semibold cursor-text"
              style={{ color: "var(--color-text)" }}
            >
              {meeting.title}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRecording && (
            <button
              onClick={onStopRecording}
              className="flex items-center gap-2 px-4 py-2 rounded-full font-medium"
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              Stop
            </button>
          )}
          {!isRecording && meeting.ended_at && (
            <>
              <button
                onClick={onTranscribe}
                disabled={!canTranscribe}
                className="px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-40"
                style={{
                  backgroundColor: "var(--color-sidebar)",
                  color: "var(--color-text)",
                }}
              >
                {isTranscribing ? "Transcribing..." : "Transcribe"}
              </button>
              <button
                onClick={onExport}
                className="p-1.5 rounded-md hover:bg-black/5"
                title="Export"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
              <button
                onClick={onCopy}
                className="p-1.5 rounded-md hover:bg-black/5"
                title="Copy"
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
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-md hover:bg-black/5"
                title="Delete"
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
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Recording indicator */}
      {isRecording && (
        <div
          className="px-8 py-3 flex items-center gap-3"
          style={{ backgroundColor: "var(--color-accent-light)" }}
        >
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            Recording
          </span>
          <div
            className="flex-1 h-1.5 rounded-full overflow-hidden"
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
        className="px-8 border-b flex gap-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        {(["notes", "transcript", "summary"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className="py-4 font-medium capitalize transition-colors"
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
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === "notes" && (
          <div>
            <textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={() => onUpdateDescription(descValue)}
              placeholder="Take notes or press / for commands..."
              className="w-full min-h-[400px] text-lg leading-relaxed resize-none"
              style={{ color: "var(--color-text)" }}
            />
          </div>
        )}

        {activeTab === "transcript" &&
          (transcript.length > 0 ? (
            <TranscriptSearch segments={transcript} />
          ) : (
            <div
              className="text-center py-16"
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
            hasTranscript={transcript.length > 0}
            hasOllamaModel={hasOllamaModel}
            ollamaRunning={ollamaRunning}
            onGenerate={(type: SummaryType, prompt?: string) =>
              generateSummary(type, prompt)
            }
            onDelete={deleteSummary}
          />
        )}
      </div>
    </div>
  );
}

export default App;
