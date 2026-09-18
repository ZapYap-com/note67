import { invoke } from "@tauri-apps/api/core";

/** Result of dual recording containing paths to all recorded files */
export interface DualRecordingResult {
  /** Path to the mic recording (null for listen-only / system-audio-only sessions) */
  micPath: string | null;
  /** Path to the system audio recording (only on supported platforms with permission) */
  systemPath: string | null;
  /** Path to the merged playback file (created after recording stops) */
  playbackPath: string | null;
}

export const audioApi = {
  // Basic recording (mic only)
  startRecording: (noteId: string): Promise<string> => {
    return invoke("start_recording", { noteId });
  },

  stopRecording: (): Promise<string | null> => {
    return invoke("stop_recording");
  },

  /** Whether a note's combined track is missing audio from some of its segments. */
  playbackNeedsRebuild: (noteId: string): Promise<boolean> => {
    return invoke("playback_needs_rebuild", { noteId });
  },

  /** Rebuild a note's combined track from its segments. Returns the path. */
  rebuildNotePlayback: (noteId: string): Promise<string> => {
    return invoke("rebuild_note_playback", { noteId });
  },

  /** Playback path for one recording segment, mixed (mic + system) on demand. */
  getSegmentPlaybackPath: (segmentId: number): Promise<string> => {
    return invoke("get_segment_playback_path", { segmentId });
  },

  getRecordingStatus: (): Promise<boolean> => {
    return invoke("get_recording_status");
  },

  getAudioLevel: (): Promise<number> => {
    return invoke("get_audio_level");
  },

  // System audio support (macOS only)
  /** Check if system audio capture is available on this platform */
  isSystemAudioSupported: (): Promise<boolean> => {
    return invoke("is_system_audio_supported");
  },

  /** Check if the app has permission to capture system audio */
  hasSystemAudioPermission: (): Promise<boolean> => {
    return invoke("has_system_audio_permission");
  },

  /** Stop dual recording with segment tracking - updates segment duration in database */
  stopDualRecordingWithSegments: (noteId: string): Promise<DualRecordingResult> => {
    return invoke("stop_dual_recording_with_segments", { noteId });
  },

  /** Pause dual recording - returns duration of paused segment in ms */
  pauseDualRecording: (): Promise<number> => {
    return invoke("pause_dual_recording");
  },

  /** Resume dual recording after pause */
  /** captureSystem: false keeps a mic-only session from trying system audio. */
  resumeDualRecording: (
    noteId: string,
    captureSystem = true
  ): Promise<DualRecordingResult> => {
    return invoke("resume_dual_recording", { noteId, captureSystem });
  },

  /** Start dual recording with segment tracking */
  startDualRecordingWithSegments: (
    noteId: string,
    captureSystem = true
  ): Promise<DualRecordingResult> => {
    return invoke("start_dual_recording_with_segments", { noteId, captureSystem });
  },

  /** Continue recording on an ended note */
  continueNoteRecording: (
    noteId: string,
    captureSystem = true
  ): Promise<DualRecordingResult> => {
    return invoke("continue_note_recording", { noteId, captureSystem });
  },

  // ========== Listen-only (system-audio-only) recording ==========
  // Used when the microphone is unavailable or denied but system audio is supported.

  /** Check if microphone is available on this device */
  hasMicrophoneAvailable: (): Promise<boolean> => {
    return invoke("has_microphone_available");
  },

  /** Check if the app has permission to use the microphone */
  hasMicrophonePermission: (): Promise<boolean> => {
    return invoke("has_microphone_permission");
  },

  /** Start listen-only recording (system audio only, no mic) with segment tracking */
  startSystemOnlyRecordingWithSegments: (
    noteId: string
  ): Promise<DualRecordingResult> => {
    return invoke("start_system_only_recording_with_segments", { noteId });
  },

  /** Stop listen-only recording */
  stopSystemOnlyRecordingWithSegments: (
    noteId: string
  ): Promise<DualRecordingResult> => {
    return invoke("stop_system_only_recording_with_segments", { noteId });
  },

  /** Pause listen-only recording */
  pauseSystemOnlyRecording: (): Promise<number> => {
    return invoke("pause_system_only_recording");
  },

  /** Resume listen-only recording after pause */
  resumeSystemOnlyRecording: (
    noteId: string
  ): Promise<DualRecordingResult> => {
    return invoke("resume_system_only_recording", { noteId });
  },
};
