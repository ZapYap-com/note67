export function ShortcutsTab() {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  const shortcuts = [
    { keys: [modKey, "N"], description: "Create new note" },
    { keys: [modKey, "R"], description: "Create new note and start recording" },
    { keys: [modKey, "S"], description: "Stop recording" },
    { keys: [modKey, "M"], description: "Toggle light/dark mode" },
    { keys: [modKey, ","], description: "Open settings" },
    { keys: ["Esc"], description: "Close modals" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Keyboard Shortcuts
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Use these shortcuts to quickly navigate and control Note67.
        </p>
      </div>

      <div className="space-y-2">
        {shortcuts.map((shortcut, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 rounded-xl"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
          >
            <span
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {shortcut.description}
            </span>
            <div className="flex items-center gap-1">
              {shortcut.keys.map((key, keyIndex) => (
                <kbd
                  key={keyIndex}
                  className="px-2 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                  }}
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
