import { invoke } from "@tauri-apps/api/core";
import type { Meeting, NewMeeting, UpdateMeeting } from "../types";

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

  update: (id: string, update: UpdateMeeting): Promise<Meeting> => {
    return invoke("update_meeting", { id, update });
  },

  search: (query: string): Promise<Meeting[]> => {
    return invoke("search_meetings", { query });
  },

  end: (id: string, audioPath?: string): Promise<void> => {
    return invoke("end_meeting", { id, audioPath });
  },

  delete: (id: string): Promise<void> => {
    return invoke("delete_meeting", { id });
  },
};
