import { invoke } from "@tauri-apps/api/core";
import type { Meeting, NewMeeting } from "../types";

export const meetingsApi = {
  create: (input: NewMeeting): Promise<Meeting> => {
    return invoke("create_meeting", { input });
  },

  get: (id: string): Promise<Meeting | null> => {
    return invoke("get_meeting", { id });
  },

  list: (): Promise<Meeting[]> => {
    return invoke("list_meetings");
  },

  end: (id: string): Promise<void> => {
    return invoke("end_meeting", { id });
  },

  delete: (id: string): Promise<void> => {
    return invoke("delete_meeting", { id });
  },
};
