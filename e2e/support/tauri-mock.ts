import type { Page } from "@playwright/test";
import type { CommandMap } from "../../src/test/tauriCommands";
import { defaultCommands } from "../../src/test/tauriCommands";

// The command fixtures live in src/test/tauriCommands.ts so vitest can share
// them. Re-exported here so existing spec imports keep working.
export type { CommandMap };
export {
  defaultCommands,
  needsSetupCommands,
  makeNote,
} from "../../src/test/tauriCommands";

/**
 * Install the Tauri IPC mock as an init script so it runs before the app's JS.
 * Implements just enough of `window.__TAURI_INTERNALS__` (invoke + the event
 * plugin + transformCallback) for the frontend to boot and for tests to drive
 * streaming events via `window.__emitTauri(event, payload)`.
 */
export async function installTauriMock(
  page: Page,
  overrides: CommandMap = {}
): Promise<void> {
  const commands = { ...defaultCommands, ...overrides };

  await page.addInitScript((config: { commands: CommandMap }) => {
    const { commands } = config;
    const listeners: Record<string, number[]> = {};
    let cbId = 0;
    const w = window as unknown as Record<string, unknown>;

    // A tiny note store so write commands (update_note, create_note, …) echo a
    // valid Note instead of null — matching real backend behaviour. Seeded from
    // whatever list_notes / get_note return.
    const noteStore: Record<string, Record<string, unknown>> = {};
    const NOTE_DEFAULTS = {
      title: "Untitled",
      description: "",
      started_at: "2026-07-02T09:00:00.000Z",
      ended_at: null,
      audio_path: null,
    };
    const rememberNote = (n: unknown) => {
      if (n && typeof n === "object" && "id" in (n as Record<string, unknown>)) {
        const note = n as Record<string, unknown>;
        noteStore[String(note.id)] = { ...NOTE_DEFAULTS, ...note };
      }
    };
    let createdCount = 0;

    // 0.1 s of 8 kHz mono silence as a data: URL.
    const silentWav = (() => {
      const rate = 8000;
      const frames = 800;
      const bytes = new Uint8Array(44 + frames * 2);
      const view = new DataView(bytes.buffer);
      const ascii = (offset: number, text: string) =>
        [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
      ascii(0, "RIFF");
      view.setUint32(4, 36 + frames * 2, true);
      ascii(8, "WAVEfmt ");
      view.setUint32(16, 16, true); // fmt chunk size
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); // byte rate
      view.setUint16(32, 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample
      ascii(36, "data");
      view.setUint32(40, frames * 2, true);
      let binary = "";
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      return `data:audio/wav;base64,${btoa(binary)}`;
    })();

    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      // Every file "loads" as the same short silent WAV, so audio players
      // render their controls in a browser (asset:// URLs can't load there).
      convertFileSrc() {
        return silentWav;
      },
      transformCallback(cb: (arg: unknown) => void) {
        const id = ++cbId;
        w[`_${id}`] = cb;
        return id;
      },
      invoke(cmd: string, args: Record<string, unknown> = {}) {
        // Every app command is logged so specs can wait for a flow to finish.
        if (!cmd.startsWith("plugin:")) {
          const calls = (w.__tauriCalls as string[] | undefined) ?? [];
          calls.push(cmd);
          w.__tauriCalls = calls;
        }
        // Event plugin — let listen()/emit() work so streaming can be simulated.
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const handler = args.handler as number;
          (listeners[event] ||= []).push(handler);
          return Promise.resolve(handler);
        }
        if (cmd === "plugin:event|unlisten" || cmd === "plugin:event|emit") {
          return Promise.resolve(null);
        }

        // Note write commands must echo a valid Note so React state never gets
        // a null. Backed by the note store seeded from reads below.
        if (cmd === "update_note") {
          const id = String(args.id);
          const updated = {
            ...NOTE_DEFAULTS,
            ...(noteStore[id] || { id }),
            ...((args.update as Record<string, unknown>) || {}),
            id,
          };
          noteStore[id] = updated;
          return Promise.resolve(updated);
        }
        if (cmd === "create_note") {
          const input = (args.input as Record<string, unknown>) || {};
          const note = { ...NOTE_DEFAULTS, id: `created-${++createdCount}`, ...input };
          noteStore[String(note.id)] = note;
          return Promise.resolve(note);
        }
        if (cmd === "reopen_note") {
          const id = String(args.id);
          const note = { ...NOTE_DEFAULTS, ...(noteStore[id] || {}), id };
          noteStore[id] = note;
          return Promise.resolve(note);
        }

        if (Object.prototype.hasOwnProperty.call(commands, cmd)) {
          const result = commands[cmd];
          // `{ __reject: "message" }` makes the command fail, like a Rust Err.
          if (result && typeof result === "object" && "__reject" in result) {
            return Promise.reject((result as { __reject: string }).__reject);
          }
          // Seed the note store from reads so subsequent writes can echo.
          if (cmd === "list_notes" && Array.isArray(result)) result.forEach(rememberNote);
          if (cmd === "get_note") rememberNote(result);
          return Promise.resolve(result);
        }
        // Unknown app command: warn so gaps are visible. Plugin calls stay quiet.
        if (!cmd.startsWith("plugin:")) {
          // eslint-disable-next-line no-console
          console.warn("[tauri-mock] unmocked command:", cmd);
        }
        return Promise.resolve(null);
      },
    };

    // The event plugin (>= recent @tauri-apps/api) unlistens via this global.
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    // Test helper: fire a Tauri event to all registered listeners.
    w.__emitTauri = (event: string, payload: unknown) => {
      for (const id of listeners[event] || []) {
        const fn = w[`_${id}`] as ((arg: unknown) => void) | undefined;
        if (fn) fn({ event, id, payload });
      }
    };
  }, { commands });
}
