export function PrivacyTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Best Practices for Recording
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          When recording conversations with other participants, follow these
          guidelines to ensure ethical and legal use.
        </p>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#22c55e" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Always Get Consent
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Inform all participants before recording begins. Get explicit
              verbal or written consent. Some jurisdictions require all-party
              consent.
            </p>
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#3b82f6" }}
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
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              State the Purpose
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Clearly explain why you're recording and how the recording will be
              used. Mention if AI transcription or summarization will be
              applied.
            </p>
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#f59e0b" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Secure Your Data
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              All recordings and transcripts are stored locally on your device.
              Delete recordings when no longer needed.
            </p>
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "#8b5cf6" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Know the Law
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Recording laws vary by location. Some regions require one-party
              consent, others require all-party consent. Check local
              regulations.
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Note67 processes everything locally. No audio or transcripts are sent to
        external servers.
      </p>
    </div>
  );
}
