/**
 * Runner-agnostic Tauri command fixtures.
 *
 * This module holds only data — no Playwright or vitest imports — so both the
 * e2e harness (`e2e/support/tauri-mock.ts`, which injects it via addInitScript)
 * and vitest unit tests (which mock the `api/` layer directly) can share one
 * definition of "what the backend returns".
 */

/**
 * A map of Tauri command name -> static JSON-serializable result.
 * Values must be serializable (the e2e harness passes them into the browser via
 * addInitScript), so responses are static per test. For dynamic behaviour,
 * override per spec or extend the harness with routing.
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
  get_notes_by_tag: [],
  search_notes: [],
  search_notes_by_title: [],

  // permissions & system (all granted by default)
  has_microphone_available: true,
  has_microphone_permission: true,
  get_microphone_auth_status: 3, // Authorized
  request_microphone_permission: true,
  open_microphone_settings: null,
  is_system_audio_supported: true,
  has_system_audio_permission: true,
  open_screen_recording_settings: null,
  get_autostart_enabled: false,
  set_autostart_enabled: null,
  // On unless switched off, as in the app.
  is_meeting_detection_enabled: true,

  // Ollama (running + model selected)
  get_ollama_status: {
    running: true,
    models: [{ name: "gemma3:4b" }],
    selected_model: "gemma3:4b",
  },
  select_ollama_model: null,

  // Whisper (a model is downloaded + loaded)
  // Shaped like the backend's ModelInfo: Settings reads every field, and a
  // model without `name` crashed the page as soon as Settings opened.
  list_models: [
    {
      size: "large-turbo-q8",
      name: "large-turbo-q8",
      downloaded: true,
      path: "/models/ggml-large-v3-turbo-q8_0.bin",
      size_mb: 874,
    },
  ],
  get_loaded_model: "large-turbo-q8",
  get_download_progress: 0,

  // recording / transcription (idle)
  get_active_recording: null,
  is_live_transcribing: false,
  get_audio_level: 0,

  // action items (#3)
  get_action_items: [],
  get_open_action_items: [],
  get_completed_action_items: [],
  extract_action_items: [],
  create_action_item: {
    id: 999,
    note_id: "note-1",
    stable_id: "x",
    text: "New action item",
    due_date: null,
    done: false,
    sort_order: 0,
    created_at: "2026-07-02T09:31:00.000Z",
    updated_at: "2026-07-02T09:31:00.000Z",
  },
  update_action_item: null,
  delete_action_item: null,

  // note detail surfaces
  get_transcript: [],
  get_note_summaries: [],
  get_note_audio_segments: [],
  migrate_legacy_audio: null,
  get_uploaded_audio: [],
  set_meeting_detection_enabled: null,
  supported_audio_formats: ["mp3", "m4a", "aac", "flac", "ogg", "wav", "mkv", "mp4"],

  // links / graph
  get_backlinks: [],
  get_graph_data: { nodes: [], edges: [] },
};

/**
 * Preset overrides that put the app in a "first-run / needs setup" state:
 * no Whisper model, Ollama not running, and permissions not yet granted.
 * This is the state the #7 onboarding wizard will trigger on.
 */
export const needsSetupCommands: CommandMap = {
  get_loaded_model: null,
  list_models: [
    { size: "large-turbo-q8", name: "large-turbo-q8", downloaded: false, path: null, size_mb: 874 },
  ],
  get_ollama_status: { running: false, models: [], selected_model: null },
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
