# UI/UX tests (Playwright + mocked Tauri IPC)

Fast harness for iterating on the **frontend** UI. It boots the React app in a
browser and stubs every `invoke()`/`listen()` call, so you can drive flows and
capture screenshots without a Rust backend, audio, Whisper, or Ollama.

## ⚠️ What this is (and isn't)

- ✅ Good for: layout, component flows, empty/ready/needs-setup states, visual
  regression of the React UI.
- ❌ **Not** the real desktop app. It runs in a Playwright browser, not Tauri's
  WKWebView. Rendering is *close* (we default to the WebKit engine) but not
  byte-identical, and nothing native (mic/screen permissions, ScreenCaptureKit,
  Whisper, Ollama, tray, autostart) actually runs — it's all mocked.
- For real desktop E2E the official route is `tauri-driver` + WebdriverIO, which
  **does not support macOS** today. Verify native behaviour manually in the app.

## Run

```bash
npm install                    # first time (adds @playwright/test)
npx playwright install webkit  # first time (downloads the WebKit browser)

npm run test:e2e               # headless
npm run test:e2e:ui            # Playwright UI mode (watch/inspect)
npm run test:e2e:report        # open the last HTML report
```

The config auto-starts `npm run dev` on :1420 (reusing a running one locally).

## How the mock works

`support/tauri-mock.ts` installs a minimal `window.__TAURI_INTERNALS__` via
`page.addInitScript` (runs before the app's JS):

- `installTauriMock(page, overrides)` — merges your `overrides` over
  `defaultCommands` (a "ready" state: model loaded, Ollama up, permissions
  granted). Each command maps to a static, JSON-serializable result.
- `needsSetupCommands` — preset for the first-run/unmet-gates state (#7).
- `makeNote(overrides)` — a minimal Note for the sidebar/note view.
- Streaming: tests can fire Tauri events with
  `await page.evaluate(([e, p]) => window.__emitTauri(e, p), ["summary-stream", {...}])`
  to exercise summary/transcript streaming.

Add a new state by passing overrides, e.g.:

```ts
await installTauriMock(page, {
  get_loaded_model: null,                 // force "no model" 
  get_note_summaries: [{ id: 1, content: "…", summary_type: "enhanced" }],
});
```

If you see `[tauri-mock] unmocked command: <name>` in the console, add a default
for it in `defaultCommands`.

## Committed vs. ignored

Everything here (config, specs, mocks) is committed so contributors can run it.
Generated output — `test-results/`, `playwright-report/`, `e2e/__screenshots__/`
— is gitignored.
