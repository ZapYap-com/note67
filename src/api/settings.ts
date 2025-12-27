import { invoke } from "@tauri-apps/api/core";

export const settingsApi = {
  get: (key: string): Promise<string | null> => {
    return invoke("get_setting", { key });
  },

  set: (key: string, value: string): Promise<void> => {
    return invoke("set_setting", { key, value });
  },

  getMultiple: (keys: string[]): Promise<Record<string, string | null>> => {
    return invoke("get_settings", { keys });
  },
};
