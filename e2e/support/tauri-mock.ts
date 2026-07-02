import type { Page } from "@playwright/test";

/**
 * A map of Tauri command name -> static JSON-serializable result.
 * Values must be serializable (they cross into the browser via addInitScript),
 * so responses are static per test. For dynamic behaviour, override per spec
 * or extend the init shim with routing.
 */
export type CommandMap = Record<string, unknown>;

/**
 * Default responses that let the app boot into a "ready" state:
 * a Whisper model is loaded, Ollama is running with a selected model, and all
 * permissions are granted. Override individual commands per test.
 */
export const defaultCommands: CommandMap = {
  // window / shell
  show_main_window: null,
  get_theme_preference: "light",
  set_theme_preference: null,

  // settings
  get_settings: {},
  get_setting: null,
  set_setting: null,

  // notes / tags / search
  list_notes: [],
  get_note: null,
  get_all_tags: [],
  get_all_note_tags: {},
  get_note_tags: [],
  get_notes_by_tag: [],
  search_notes: [],
  search_notes_by_title: [],
  sync_note_tags: null,

  // permissions & system (all granted by default)
  has_microphone_available: true,
  has_microphone_permission: true,
  get_microphone_auth_status: 3, // Authorized
  request_microphone_permission: true,
  open_microphone_settings: null,
  is_system_audio_supported: true,
  has_system_audio_permission: true,
  request_system_audio_permission: true,
  open_screen_recording_settings: null,
  get_autostart_enabled: false,
  set_autostart_enabled: null,
  is_meeting_detection_enabled: false,
  is_aec_enabled: true,

  // Ollama (running + model selected)
  get_ollama_status: {
    running: true,
    models: [{ name: "gemma3:4b" }],
    selected_model: "gemma3:4b",
  },
  list_ollama_models: [{ name: "gemma3:4b" }],
  get_selected_model: "gemma3:4b",
  select_ollama_model: null,
  is_ai_generating: false,

  // Whisper (a model is downloaded + loaded)
  list_models: [{ size: "large-v3-turbo", downloaded: true }],
  get_loaded_model: "large-v3-turbo",
  is_downloading: false,
  get_download_progress: 0,

  // recording / transcription (idle)
  get_recording_status: false,
  get_recording_phase: null,
  is_live_transcribing: false,
  is_dual_recording: false,
  is_transcribing: false,
  get_audio_level: 0,

  // note detail surfaces
  get_transcript: [],
  get_note_summaries: [],
  get_note_audio_segments: [],
  migrate_legacy_audio: null,
  get_uploaded_audio: [],

  // links / graph
  get_backlinks: [],
  get_unlinked_mentions: [],
  get_broken_link_titles: [],
  get_note_links: [],
  get_graph_data: { nodes: [], edges: [] },
};

/**
 * Preset overrides that put the app in a "first-run / needs setup" state:
 * no Whisper model, Ollama not running, and permissions not yet granted.
 * This is the state the #7 onboarding wizard will trigger on.
 */
export const needsSetupCommands: CommandMap = {
  get_loaded_model: null,
  list_models: [{ size: "large-v3-turbo", downloaded: false }],
  get_ollama_status: { running: false, models: [], selected_model: null },
  list_ollama_models: [],
  get_selected_model: null,
  has_microphone_permission: false,
  get_microphone_auth_status: 0, // NotDetermined
  has_system_audio_permission: false,
};

/** Minimal Note shape matching what the sidebar/note view read. */
export function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: "note-1",
    title: "Weekly Sync",
    description: "",
    started_at: "2026-07-02T09:00:00.000Z",
    ended_at: "2026-07-02T09:30:00.000Z",
    audio_path: null,
    ...overrides,
  };
}

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

    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback(cb: (arg: unknown) => void) {
        const id = ++cbId;
        w[`_${id}`] = cb;
        return id;
      },
      invoke(cmd: string, args: Record<string, unknown> = {}) {
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
