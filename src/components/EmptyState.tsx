import { LogoImage } from "./LogoImage";

export interface EmptyStateProps {
  needsSetup: boolean;
  onOpenSettings: () => void;
}

export function EmptyState({ needsSetup, onOpenSettings }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center pb-20">
      <div className="text-center max-w-sm px-6">
        <LogoImage className="w-32 h-auto mx-auto mb-4" />
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Select a note or start a new one
        </p>
        <div
          className="mt-4 flex flex-col items-start gap-2 text-xs mx-auto w-fit"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              K
            </kbd>
            <span>search notes</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              N
            </kbd>
            <span>new note</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              R
            </kbd>
            <span>start recording</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              M
            </kbd>
            <span>toggle theme</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ⌘
            </kbd>
            <kbd
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: "var(--color-sidebar)",
                border: "1px solid var(--color-border)",
              }}
            >
              ,
            </kbd>
            <span>settings</span>
          </div>
        </div>
        {needsSetup && (
          <button
            onClick={onOpenSettings}
            className="mt-4 flex items-center gap-2 mx-auto px-3 py-2 text-sm rounded-lg transition-colors hover:bg-black/5"
            style={{
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }}
          >
            <svg
              className="w-4 h-4"
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
            Set up transcription
          </button>
        )}
      </div>
    </div>
  );
}
