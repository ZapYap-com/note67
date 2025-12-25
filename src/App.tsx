import { useState } from "react";
import { useMeetings } from "./hooks";
import type { Meeting } from "./types";

function App() {
  const { meetings, loading, error, createMeeting, endMeeting, deleteMeeting } =
    useMeetings();
  const [newTitle, setNewTitle] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await createMeeting(newTitle.trim());
    setNewTitle("");
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Note67
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Your private, local meeting notes assistant
        </p>

        {/* Create Meeting Form */}
        <form onSubmit={handleCreate} className="flex gap-2 mb-8">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Meeting title..."
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium
                       hover:bg-blue-700 transition-colors"
          >
            Start Meeting
          </button>
        </form>

        {/* Error State */}
        {error && (
          <div className="p-4 mb-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg">
            {error}
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
              onEnd={() => endMeeting(meeting.id)}
              onDelete={() => deleteMeeting(meeting.id)}
              formatDate={formatDate}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

interface MeetingCardProps {
  meeting: Meeting;
  onEnd: () => void;
  onDelete: () => void;
  formatDate: (date: string) => string;
}

function MeetingCard({
  meeting,
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
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Started: {formatDate(meeting.started_at)}
          </p>
          {meeting.ended_at && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Ended: {formatDate(meeting.ended_at)}
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
            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
