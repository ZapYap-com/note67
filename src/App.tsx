import { useState } from "react";
import { useMeetings, useRecording } from "./hooks";
import type { Meeting } from "./types";

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
  const [newTitle, setNewTitle] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const meeting = await createMeeting(newTitle.trim());
    setNewTitle("");
    // Automatically start recording for new meeting
    await startRecording(meeting.id);
  };

  const handleEndMeeting = async (meetingId: string) => {
    await stopRecording();
    await endMeeting(meetingId);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const displayError = error || recordingError;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Note67
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Your private, local meeting notes assistant
        </p>

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
          <p className="text-gray-500 dark:text-gray-400">
            Loading meetings...
          </p>
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
              onEnd={() => handleEndMeeting(meeting.id)}
              onDelete={() => deleteMeeting(meeting.id)}
              formatDate={formatDate}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function AudioLevelMeter({ level }: { level: number }) {
  // Convert RMS to a 0-100 scale (with some amplification for visibility)
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
  onEnd: () => void;
  onDelete: () => void;
  formatDate: (date: string) => string;
}

function MeetingCard({
  meeting,
  isRecording,
  onEnd,
  onDelete,
  formatDate,
}: MeetingCardProps) {
  const isActive = !meeting.ended_at;

  return (
    <div
      className={`p-4 rounded-lg border ${
        isActive
          ? "border-green-500 bg-green-50 dark:bg-green-900/20"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
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
        <div className="flex gap-2">
          {isActive && (
            <button
              onClick={onEnd}
              className="px-3 py-1 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
            >
              End
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={isActive && isRecording}
            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
