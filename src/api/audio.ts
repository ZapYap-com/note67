import { invoke } from "@tauri-apps/api/core";

export const audioApi = {
  startRecording: (meetingId: string): Promise<string> => {
    return invoke("start_recording", { meetingId });
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
};
