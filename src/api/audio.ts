import { invoke } from "@tauri-apps/api/core";

/** Result of dual recording containing paths to all recorded files */
export interface DualRecordingResult {
  /** Path to the mic recording (always present) */
  micPath: string;
  /** Path to the system audio recording (only on supported platforms with permission) */
  systemPath: string | null;
  /** Path to the merged playback file (created after recording stops) */
  playbackPath: string | null;
}

export const audioApi = {
  // Basic recording (mic only)
  startRecording: (noteId: string): Promise<string> => {
    return invoke("start_recording", { note_id: noteId });
  },

  stopRecording: (): Promise<string | null> => {
    return invoke("stop_recording");
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

  /** Request permission to capture system audio (triggers system dialog on macOS) */
  requestSystemAudioPermission: (): Promise<boolean> => {
    return invoke("request_system_audio_permission");
  },

  // Dual recording (mic + system audio)
  /** Start recording both mic and system audio */
  startDualRecording: (noteId: string): Promise<DualRecordingResult> => {
    return invoke("start_dual_recording", { note_id: noteId });
  },

  /** Stop dual recording and merge files for playback */
  stopDualRecording: (noteId: string): Promise<DualRecordingResult> => {
    return invoke("stop_dual_recording", { note_id: noteId });
  },

  /** Check if dual recording is currently active */
  isDualRecording: (): Promise<boolean> => {
    return invoke("is_dual_recording");
  },
};
