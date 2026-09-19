import { useState } from "react";
import { useUpdater } from "../../hooks";
import { APP_VERSION } from "./constants";

export function UpdatesTab() {
  const {
    checking,
    available,
    version,
    body,
    downloading,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
  } = useUpdater();
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const handleCheckUpdates = async () => {
    await checkForUpdates();
    setLastChecked(new Date().toLocaleTimeString());
  };

  const recentChanges = [
    {
      version: "0.1.28",
      date: "September 2026",
      changes: [
        "Meeting detection can be turned off in Settings > System - it prompts once per call, never during a recording, and not just because Teams or Discord is open",
        "The meeting prompt shows even when Note67 is closed to the menu bar, and goes away a couple of minutes after the call ends",
        "Uploaded audio is transcribed as soon as it's added, and stopping a recording while an upload is transcribing no longer skips the recording's final transcription",
        "Deleting a task can be undone for a few seconds, subtasks included, and deleting a note tells you how many tasks go with it",
        "Overdue tasks are highlighted in a note's Tasks tab too, and task checkboxes work with the keyboard and screen readers",
        "Links in summaries, Settings and first-run setup open in your browser (the Settings and setup links had done nothing since 0.1.22)",
        "When Retranscribe fails, Note67 says why and keeps the transcript you had",
        "Fixed Note67's window not coming back after it started at login, and clicking through a task's details marking it as edited",
        "Security - Note67's window reaches only your recordings and the files you choose to save, and HTML in a note, transcript or AI summary can't run code or send the window elsewhere",
        "Privacy - images from the web no longer load in notes or summaries, so an AI summary can't use one to send your notes somewhere; images you paste still show",
        "Security - updated the secure-connection library the updater uses for a security advisory",
        "About 2,500 lines of unused code and five unused libraries removed",
      ],
    },
    {
      version: "0.1.27",
      date: "Included in 0.1.28",
      changes: [
        "Fixed the app quitting after a recording when the summary contained Chinese, Japanese or Korean text, or an emoji or em dash in the wrong place",
        "Fixed the app quitting when opening a note that another note mentions near non-English text (the \"unlinked mentions\" panel behind it is removed)",
        "Fixed microphone-only recordings ending with an empty transcript and losing everything recorded before a pause, and continuing an older recording overwriting it",
        "Non-English meetings are no longer re-transcribed in English after Stop - your transcription language is used everywhere",
        "Notes typed during a meeting are saved as you type and before the summary is written, and clearing a note's text now sticks",
        "Only one recording runs at a time, so a second one can no longer file a meeting's audio under the wrong note",
        "Recording no longer needs Ollama - a transcription model is enough, and Ollama adds summaries, titles and tasks when it's running",
        "Summarize no longer renames notes you've titled yourself, and search works with hyphens, apostrophes, dots and email addresses",
        "Finding tasks reads the whole of a long meeting without adding the same task twice, and tasks you add yourself no longer turn overdue the next day",
        "Uploaded audio plays and transcribes on notes without a recording, and mono .m4a files such as voice memos convert at full length",
        "Right-click in the editor shows the normal Cut, Copy, Paste and spelling menu",
        "Coming in 0.2 - Note67 focuses on meeting notes: the graph view, hashtags, backlinks, the Cmd+J writing sidebar and PDF export are going away (Markdown export stays), and nothing you wrote is deleted",
      ],
    },
    {
      version: "0.1.26",
      date: "August 2026",
      changes: [
        "Security - updated bundled third-party components to patch five known vulnerabilities, including the sanitizer that cleans pasted content in the editor",
      ],
    },
    {
      version: "0.1.25",
      date: "July 2026",
      changes: [
        "Fixed your own voice missing from the transcript - quiet microphones are now boosted before transcription instead of being treated as silence",
        "Fixed short replies like \"hello\" or \"thanks\" being dropped from the live transcript",
        "Fixed speech being discarded when you talk at the same time as the meeting audio",
        "Whisper's stage directions (*Slow's voice*, *sighs*) no longer show up as transcript lines",
        "Live transcription now appears below earlier recordings instead of jumping to the top, and stays in view as it arrives",
        "Fixed silent playback audio when continuing a recording",
        "Retranscription no longer loses your existing transcript if it's interrupted",
        "Recommended transcription model is now Turbo Q8 - same quality and speed, half the download",
        "Faster startup and a smaller app bundle",
      ],
    },
    {
      version: "0.1.24",
      date: "July 2026",
      changes: [
        "Tasks - turn a meeting's action items into a real to-do list, or add standalone tasks; each task has a due date, description, and subtasks",
        "Central Tasks page - open tasks from every meeting in one place, grouped by date (Overdue / Today / Tomorrow / Future) with quick filters",
        "AI 'Generate' pulls action items straight from a meeting into your task list; click a task to jump back to its note",
        "Smarter summaries - when you take your own notes, the AI summary now expands them with detail from the transcript instead of ignoring them",
        "First-run setup wizard - guided setup for the transcription model, AI assistant, and microphone/screen permissions",
      ],
    },
    {
      version: "0.1.23",
      date: "June 2026",
      changes: [
        "Cleaner transcripts - long monologues now break into readable sentences instead of one block of text",
        "Interval timestamps - a timestamp is shown every 30 seconds within a speaker turn for easier navigation",
        "Fixed transcript ordering - the last line no longer jumps to the top after post-recording enhancement",
        "Smarter noise filtering - drops Whisper hallucinations (stray punctuation, repeated 'Thank you', stuck words) on silence",
        "Improved echo handling - better removal of microphone pickup of speaker audio when not using headphones",
        "Transcript search no longer breaks when searching for special characters",
      ],
    },
    {
      version: "0.1.22",
      date: "May 2026",
      changes: [
        "Listen-only recording mode - capture system audio without microphone",
        "Record meetings when mic is unavailable or only system audio is needed",
        "Live transcription support in listen-only mode",
        "Improved loading indicator during post-recording retranscription",
      ],
    },
    {
      version: "0.1.21",
      date: "April 2026",
      changes: [
        "Wiki-style links - type [[Note Title]] to link between notes",
        "Link aliases - use [[Title|display text]] syntax for custom link text",
        "Link preview on hover - hover to see snippet, click preview to navigate",
        "Link autocomplete - type [[ to see note suggestions",
        "Backlinks panel - see which notes link to the current note",
        "Unlinked mentions - find notes that mention this note's title without [[]]",
        "Auto-update links when note title changes (like Obsidian)",
        "Hashtag support - type #tag in notes for auto-extraction and filtering",
        "Tag autocomplete - type # to see suggestions with keyboard navigation",
        "Auto-generated tag colors based on tag name",
        "Global search (Cmd+K) - full-text search across all notes with highlights",
        "Updated recommended Ollama model to Gemma 4",
      ],
    },
    {
      version: "0.1.20",
      date: "April 2026",
      changes: [
        "Added Whisper large-v3-turbo model (8x faster, similar accuracy to large-v3)",
        "Added quantized model variants (Q8) for smaller downloads and lower memory usage",
        "Changed recommended model from base to large-turbo for better transcription quality",
      ],
    },
    {
      version: "0.1.19",
      date: "April 2026",
      changes: [
        "Minor bug fixes and performance improvements",
      ],
    },
    {
      version: "0.1.18",
      date: "February 2026",
      changes: [
        "AI writing assistant sidebar - improve, summarize, expand, or rewrite notes with AI",
        "Quick actions: Summarize, Action Items, Improve, Expand, Fix Grammar, Bullets",
        "Chat interface for custom AI requests",
        "Insert or replace note content with AI-generated text",
        "Keyboard shortcut Cmd+J to toggle AI sidebar",
      ],
    },
    {
      version: "0.1.17",
      date: "February 2026",
      changes: [
        "Rich markdown editor with live preview (Notion-style)",
        "Local image storage - paste images directly into notes",
        "Images auto-cleanup when note is deleted",
        "Slash commands (/) for quick formatting",
        "LaTeX/math support in notes",
      ],
    },
    {
      version: "0.1.16",
      date: "January 2026",
      changes: [
        "Auto-retranscribe after recording stops for better transcript quality",
        "Retranscribe All button to re-transcribe audio with different Whisper model",
        "Echo filtering to remove duplicate mic audio from speaker output",
        "Fixed speaker labels for legacy recordings during retranscription",
        "Filtered out Whisper artifacts ([AUDIO OUT]) from transcripts",
        "Fixed transcript layout not filling available space",
        "Fixed retranscribe button not appearing after first recording",
      ],
    },
    {
      version: "0.1.15",
      date: "January 2026",
      changes: [
        "Reorganized note header with dropdown menu for actions",
        "Summarize button in header for quick AI summary generation",
        "Audio files list moved to expandable panel in audio player",
        "Download button for audio files",
        "Delete confirmation dialog for audio files",
        "Deleting uploaded audio now removes associated transcripts",
      ],
    },
    {
      version: "0.1.14",
      date: "January 2026",
      changes: [
        "Windows executable release (.exe)",
        "Fixed autostart (Launch at Login) initialization",
      ],
    },
    {
      version: "0.1.13",
      date: "January 2026",
      changes: [
        "Windows support with system audio capture (WASAPI)",
        "Cross-platform speaker distinction (You vs Others)",
        "Windows microphone settings integration",
      ],
    },
    {
      version: "0.1.12",
      date: "December 2025",
      changes: [
        "Initial release",
        "Local Whisper transcription",
        "Ollama integration for AI summaries",
        "Note management and organization",
        "Export to Markdown",
        "Privacy-focused design",
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Current Version */}
      <div
        className="p-4 rounded-xl flex items-center justify-between"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text)" }}
          >
            Current Version
          </p>
          <p
            className="text-2xl font-bold mt-1"
            style={{ color: "var(--color-accent)" }}
          >
            {APP_VERSION}
          </p>
        </div>
        <button
          onClick={handleCheckUpdates}
          disabled={checking}
          className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
          }}
        >
          {checking ? "Checking..." : "Check for Updates"}
        </button>
      </div>

      {/* Update Available */}
      {available && version && (
        <div
          className="p-4 rounded-xl"
          style={{
            backgroundColor: "var(--color-accent-light)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p
              className="text-sm font-medium"
              style={{ color: "var(--color-text)" }}
            >
              Update Available: v{version}
            </p>
            <button
              onClick={downloadAndInstall}
              disabled={downloading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {downloading ? "Installing..." : "Install Update"}
            </button>
          </div>
          {body && (
            <p
              className="text-xs mt-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {body}
            </p>
          )}
          {downloading && (
            <div className="mt-3">
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: "var(--color-accent)",
                  }}
                />
              </div>
              <p
                className="text-xs mt-1 text-right"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {progress}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div
          className="p-3 rounded-lg text-sm"
          style={{
            backgroundColor: "#fef2f2",
            color: "#dc2626",
            border: "1px solid #fecaca",
          }}
        >
          {error}
        </div>
      )}

      {lastChecked && !available && (
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          Last checked: {lastChecked} — You're up to date!
        </p>
      )}

      {/* Recent Changes */}
      <div>
        <h3
          className="text-sm font-medium mb-3"
          style={{ color: "var(--color-text)" }}
        >
          What's New
        </h3>
        <div className="space-y-4">
          {recentChanges.map((release) => (
            <div
              key={release.version}
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--color-bg-subtle)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="px-2 py-0.5 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--color-accent-light)",
                    color: "var(--color-accent)",
                  }}
                >
                  v{release.version}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {release.date}
                </span>
              </div>
              <ul className="space-y-1.5">
                {release.changes.map((change, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-sm"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    <svg
                      className="w-4 h-4 shrink-0 mt-0.5"
                      style={{ color: "#22c55e" }}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-update info */}
      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Updates are downloaded and installed automatically when available.
      </p>
    </div>
  );
}
