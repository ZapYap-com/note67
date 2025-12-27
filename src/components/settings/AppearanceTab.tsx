import { useThemeStore } from "../../stores/themeStore";

export function AppearanceTab() {
  const { theme, setTheme } = useThemeStore();

  const themeOptions: {
    value: "light" | "dark" | "system";
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "light",
      label: "Light",
      description: "Always use light mode",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
    },
    {
      value: "dark",
      label: "Dark",
      description: "Always use dark mode",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
    {
      value: "system",
      label: "System",
      description: "Match your system settings",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--color-text)" }}
        >
          Theme
        </h3>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Choose how Note67 looks to you.
        </p>
      </div>

      <div className="space-y-2">
        {themeOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
            style={{
              backgroundColor:
                theme === option.value
                  ? "rgba(59, 130, 246, 0.06)"
                  : "var(--color-bg-subtle)",
              border:
                theme === option.value
                  ? "1px solid rgba(59, 130, 246, 0.2)"
                  : "1px solid transparent",
            }}
          >
            <span
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor:
                  theme === option.value
                    ? "var(--color-accent-light)"
                    : "var(--color-bg-elevated)",
                color:
                  theme === option.value
                    ? "var(--color-accent)"
                    : "var(--color-text-secondary)",
              }}
            >
              {option.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium" style={{ color: "var(--color-text)" }}>
                {option.label}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {option.description}
              </p>
            </div>
            {theme === option.value && (
              <svg
                className="w-5 h-5 shrink-0"
                style={{ color: "var(--color-accent)" }}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        Your theme preference is stored locally on this device.
      </p>
    </div>
  );
}
