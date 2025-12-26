import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  isLoaded: boolean;
  setTheme: (theme: Theme) => void;
  loadTheme: () => Promise<void>;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: "system",
  isLoaded: false,
  setTheme: async (theme: Theme) => {
    set({ theme });
    applyTheme(theme);
    try {
      await invoke("set_theme_preference", { theme });
    } catch (error) {
      console.error("Failed to save theme preference:", error);
    }
  },
  loadTheme: async () => {
    try {
      const theme = await invoke<string>("get_theme_preference");
      const validTheme = (["light", "dark", "system"].includes(theme) ? theme : "system") as Theme;
      set({ theme: validTheme, isLoaded: true });
      applyTheme(validTheme);
    } catch (error) {
      console.error("Failed to load theme preference:", error);
      set({ isLoaded: true });
    }
  },
  toggleTheme: () => {
    const { theme, setTheme } = get();
    // Get current actual appearance
    const isDark = document.documentElement.classList.contains("dark");

    if (theme === "system") {
      // If system, switch to the opposite of current appearance
      setTheme(isDark ? "light" : "dark");
    } else if (theme === "light") {
      setTheme("dark");
    } else {
      setTheme("light");
    }
  },
}));

// Apply theme to document
export function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}
