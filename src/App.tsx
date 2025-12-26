import { useState } from "react";
import { ModelManager, OllamaSettings, SummaryPanel, TranscriptSearch } from "./components";
import { useMeetings, useModels, useOllama, useRecording, useSummaries, useTranscription } from "./hooks";
import type { Meeting, SummaryType, TranscriptSegment } from "./types";

function App() {
  const { meetings, loading, error, createMeeting, endMeeting, deleteMeeting } =
    useMeetings();
  const {
    isRecording,
    audioLevel,
    error: recordingError,
    startRecording,
    stopRecording,
  } = useRecording();
  const { loadedModel } = useModels();
  const {
    isTranscribing,
    transcript,
    error: transcriptionError,
    transcribe,
    loadTranscript,
  } = useTranscription();
  const { isRunning: ollamaRunning, selectedModel: ollamaModel } = useOllama();

  const [newTitle, setNewTitle] = useState("");
  const [showModelManager, setShowModelManager] = useState(false);
  const [showOllamaSettings, setShowOllamaSettings] = useState(false);
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"transcript" | "summary">("transcript");
  const [meetingTranscripts, setMeetingTranscripts] = useState<Record<string, TranscriptSegment[]>>({});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const meeting = await createMeeting(newTitle.trim());
    setNewTitle("");
    await startRecording(meeting.id);
  };

  const handleEndMeeting = async (meetingId: string) => {
    await stopRecording();
    await endMeeting(meetingId);
  };

  const handleTranscribe = async (meeting: Meeting) => {
    if (!meeting.audio_path || !loadedModel) return;
    const result = await transcribe(meeting.audio_path, meeting.id);
    if (result) {
      setMeetingTranscripts((prev) => ({
        ...prev,
        [meeting.id]: result.segments.map((s, idx) => ({
          id: idx,
          meeting_id: meeting.id,
          start_time: s.start_time,
          end_time: s.end_time,
          text: s.text,
          speaker: null,
          created_at: new Date().toISOString(),
        })),
      }));
      setExpandedMeetingId(meeting.id);
    }
  };

  const handleLoadTranscript = async (meetingId: string) => {
    await loadTranscript(meetingId);
    if (transcript.length > 0) {
      setMeetingTranscripts((prev) => ({
        ...prev,
        [meetingId]: transcript,
      }));
    }
    setExpandedMeetingId((prev) => (prev === meetingId ? null : meetingId));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const displayError = error || recordingError || transcriptionError;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Note67
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              Your private, local meeting notes assistant
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowOllamaSettings(true)}
              className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI
              {ollamaRunning && ollamaModel && (
                <span className="w-2 h-2 bg-green-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setShowModelManager(true)}
              className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Whisper
              {loadedModel && (
                <span className="px-1.5 py-0.5 text-xs bg-green-500 text-white rounded">
                  {loadedModel}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Recording Status */}
        {isRecording && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-700 dark:text-red-300 font-medium">
                Recording in progress
              </span>
              <AudioLevelMeter level={audioLevel} />
            </div>
          </div>
        )}

        {/* Create Meeting Form */}
        <form onSubmit={handleCreate} className="flex gap-2 mb-8">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Meeting title..."
            disabled={isRecording}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                       focus:outline-none focus:ring-2 focus:ring-blue-500
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={isRecording}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium
                       hover:bg-blue-700 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Meeting
          </button>
        </form>

        {/* Error State */}
        {displayError && (
          <div className="p-4 mb-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg">
            {displayError}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <p className="text-gray-500 dark:text-gray-400">Loading meetings...</p>
        )}

        {/* Meetings List */}
        {!loading && meetings.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            No meetings yet. Start your first meeting above.
          </p>
        )}

        <div className="space-y-4">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              hasModel={!!loadedModel}
              isExpanded={expandedMeetingId === meeting.id}
              activeTab={activeTab}
              transcript={meetingTranscripts[meeting.id] || []}
              ollamaRunning={ollamaRunning}
              hasOllamaModel={!!ollamaModel}
              onEnd={() => handleEndMeeting(meeting.id)}
              onDelete={() => deleteMeeting(meeting.id)}
              onTranscribe={() => handleTranscribe(meeting)}
              onToggleTranscript={() => handleLoadTranscript(meeting.id)}
              onTabChange={setActiveTab}
              formatDate={formatDate}
            />
          ))}
        </div>
      </div>

      {/* Model Manager Modal */}
      {showModelManager && (
        <ModelManager onClose={() => setShowModelManager(false)} />
      )}

      {/* Ollama Settings Modal */}
      {showOllamaSettings && (
        <OllamaSettings onClose={() => setShowOllamaSettings(false)} />
      )}
    </main>
  );
}

function AudioLevelMeter({ level }: { level: number }) {
  const normalizedLevel = Math.min(100, level * 500);

  return (
    <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
      <div
        className="h-full bg-green-500 transition-all duration-75"
        style={{ width: `${normalizedLevel}%` }}
      />
    </div>
  );
}

interface MeetingCardProps {
  meeting: Meeting;
  isRecording: boolean;
  isTranscribing: boolean;
  hasModel: boolean;
  isExpanded: boolean;
  activeTab: "transcript" | "summary";
  transcript: TranscriptSegment[];
  ollamaRunning: boolean;
  hasOllamaModel: boolean;
  onEnd: () => void;
  onDelete: () => void;
  onTranscribe: () => void;
  onToggleTranscript: () => void;
  onTabChange: (tab: "transcript" | "summary") => void;
  formatDate: (date: string) => string;
}

function MeetingCard({
  meeting,
  isRecording,
  isTranscribing,
  hasModel,
  isExpanded,
  activeTab,
  transcript,
  ollamaRunning,
  hasOllamaModel,
  onEnd,
  onDelete,
  onTranscribe,
  onToggleTranscript,
  onTabChange,
  formatDate,
}: MeetingCardProps) {
  const isActive = !meeting.ended_at;
  const canTranscribe = !isActive && meeting.audio_path && hasModel && !isTranscribing;
  const hasTranscript = transcript.length > 0;

  // Use summaries hook for this meeting
  const { summaries, isGenerating, generateSummary, deleteSummary } = useSummaries(
    isExpanded ? meeting.id : null
  );

  const handleGenerateSummary = (type: SummaryType, customPrompt?: string) => {
    generateSummary(type, customPrompt);
  };

  return (
    <div
      className={`rounded-lg border ${
        isActive
          ? "border-green-500 bg-green-50 dark:bg-green-900/20"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
              {meeting.title}
              {isActive && (
                <span className="px-2 py-0.5 text-xs bg-green-500 text-white rounded-full">
                  Active
                </span>
              )}
              {isActive && isRecording && (
                <span className="px-2 py-0.5 text-xs bg-red-500 text-white rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  Recording
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Started: {formatDate(meeting.started_at)}
            </p>
            {meeting.ended_at && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ended: {formatDate(meeting.ended_at)}
              </p>
            )}
            {meeting.audio_path && (
              <p className="text-sm text-blue-500 dark:text-blue-400 mt-1">
                Audio saved
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {isActive ? (
              <button
                onClick={onEnd}
                className="px-3 py-1 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
              >
                End
              </button>
            ) : (
              <>
                {meeting.audio_path && (
                  <button
                    onClick={canTranscribe ? onTranscribe : undefined}
                    disabled={!canTranscribe}
                    title={!hasModel ? "Load a model first" : undefined}
                    className="px-3 py-1 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTranscribing ? "..." : "Transcribe"}
                  </button>
                )}
                {hasTranscript && (
                  <button
                    onClick={onToggleTranscript}
                    className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    {isExpanded ? "Hide" : "Show"}
                  </button>
                )}
              </>
            )}
            <button
              onClick={onDelete}
              disabled={isActive && isRecording}
              className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Transcription in progress */}
      {isTranscribing && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-purple-50 dark:bg-purple-900/20">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-purple-300 border-t-purple-600" />
            <span className="text-sm text-purple-700 dark:text-purple-300">
              Transcribing audio...
            </span>
          </div>
        </div>
      )}

      {/* Expanded Section with Tabs */}
      {isExpanded && hasTranscript && !isTranscribing && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => onTabChange("transcript")}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "transcript"
                  ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Transcript
            </button>
            <button
              onClick={() => onTabChange("summary")}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "summary"
                  ? "text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              AI Summary
              {summaries.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 rounded-full">
                  {summaries.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
            {activeTab === "transcript" ? (
              <TranscriptSearch segments={transcript} />
            ) : (
              <SummaryPanel
                summaries={summaries}
                isGenerating={isGenerating}
                hasTranscript={hasTranscript}
                hasOllamaModel={hasOllamaModel}
                ollamaRunning={ollamaRunning}
                onGenerate={handleGenerateSummary}
                onDelete={deleteSummary}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
