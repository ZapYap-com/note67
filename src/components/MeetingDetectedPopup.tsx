import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useMeetingStore } from "../stores/meetingStore";

interface MeetingDetectedPayload {
  app_name: string;
  bundle_id: string | null;
  is_browser: boolean;
}

interface MeetingDetectedPopupProps {
  onStartListening: () => void;
}

export function MeetingDetectedPopup({
  onStartListening,
}: MeetingDetectedPopupProps) {
  const { detectedMeeting, dismissed, setDetectedMeeting, dismissMeeting } =
    useMeetingStore();

  // Listen for meeting-detected events from Rust
  useEffect(() => {
    const unlisten = listen<MeetingDetectedPayload>(
      "meeting-detected",
      (event) => {
        setDetectedMeeting(event.payload);
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setDetectedMeeting]);

  if (!detectedMeeting || dismissed) return null;

  const handleStartListening = () => {
    dismissMeeting();
    onStartListening();
  };

  return (
    <div
      className="fixed bottom-20 left-4 z-50 max-w-sm rounded-xl p-4 shadow-lg animate-in slide-in-from-left-5"
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--color-accent-light)" }}
        >
          <svg
            className="w-5 h-5"
            style={{ color: "var(--color-accent)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text)" }}
          >
            {detectedMeeting.app_name} Detected
          </p>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Would you like to start recording this meeting?
          </p>

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleStartListening}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              Start Listening
            </button>
            <button
              onClick={dismissMeeting}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                color: "var(--color-text-secondary)",
              }}
            >
              Not Now
            </button>
          </div>
        </div>
        <button
          onClick={dismissMeeting}
          className="shrink-0 p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
