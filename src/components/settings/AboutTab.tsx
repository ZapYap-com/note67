import { LogoImage } from "../LogoImage";
import { APP_VERSION } from "./constants";

export function AboutTab() {
  return (
    <div className="space-y-6">
      {/* Logo and App Name */}
      <div className="text-center pb-4">
        <LogoImage className="w-32 h-auto mx-auto mb-4" />
        <p
          className="text-sm mt-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Version {APP_VERSION}
        </p>
      </div>

      {/* Description */}
      <div
        className="p-4 rounded-xl text-center"
        style={{ backgroundColor: "var(--color-bg-subtle)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-text)" }}>
          A privacy-focused notes app with local AI transcription and
          summarization.
        </p>
      </div>

      {/* Privacy Commitment */}
      <div
        className="p-4 rounded-xl"
        style={{ backgroundColor: "rgba(34, 197, 94, 0.06)" }}
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
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <div>
            <h4
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text)" }}
            >
              Privacy First
            </h4>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              All processing happens locally on your device. Your recordings,
              transcripts, and notes never leave your computer. No cloud, no
              tracking, no compromises.
            </p>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="space-y-2">
        <h4
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Features
        </h4>
        <ul
          className="space-y-1.5 text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            Local speech-to-text with Whisper
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            AI summaries powered by Ollama
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            Export to Markdown
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>•</span>
            100% offline capable
          </li>
        </ul>
      </div>

      {/* Credits */}
      <div className="space-y-3 text-center">
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          Built with <span style={{ color: "#ef4444" }}>♥</span> by{" "}
          <a
            href="https://ctmakes.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={{ color: "var(--color-accent)" }}
          >
            @ctmakes
          </a>
        </p>
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          If you like this app, consider checking out{" "}
          <a
            href="https://leapcount.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={{ color: "var(--color-accent)" }}
          >
            Leapcount
          </a>
          {" and "}
          <a
            href="https://zapyap.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={{ color: "var(--color-accent)" }}
          >
            ZapYap
          </a>{" "}
          as well.
        </p>
      </div>
    </div>
  );
}
