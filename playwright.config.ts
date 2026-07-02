import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Note67's UI/UX harness.
 *
 * IMPORTANT: this drives the React frontend in a *browser*, not the real Tauri
 * desktop webview. All `invoke()`/`listen()` calls are mocked (see
 * e2e/support/tauri-mock.ts). Use it for layout/flow/visual checks of the UI —
 * NOT as proof the desktop app works. Anything touching audio, permissions,
 * Whisper, Ollama, or true WKWebView rendering must be verified in the real app.
 *
 * We default to the WebKit engine because macOS Tauri renders in WKWebView;
 * WebKit is the closest approximation (still not byte-identical). Add the
 * chromium project below if you want to compare.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    // Uncomment to cross-check rendering against Blink:
    // { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Boot the same dev server Tauri uses (vite on :1420). Reuse a running one locally.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
