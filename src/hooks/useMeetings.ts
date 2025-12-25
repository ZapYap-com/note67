import { useCallback, useEffect, useState } from "react";
import { meetingsApi } from "../api";
import type { Meeting } from "../types";

interface UseMeetingsReturn {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createMeeting: (title: string) => Promise<Meeting>;
  endMeeting: (id: string) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
}

export function useMeetings(): UseMeetingsReturn {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await meetingsApi.list();
      setMeetings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const createMeeting = useCallback(async (title: string): Promise<Meeting> => {
    const meeting = await meetingsApi.create({ title });
    setMeetings((prev) => [meeting, ...prev]);
    return meeting;
  }, []);

  const endMeeting = useCallback(async (id: string): Promise<void> => {
    await meetingsApi.end(id);
    setMeetings((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, ended_at: new Date().toISOString() } : m
      )
    );
  }, []);

  const deleteMeeting = useCallback(async (id: string): Promise<void> => {
    await meetingsApi.delete(id);
    setMeetings((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    meetings,
    loading,
    error,
    refresh,
    createMeeting,
    endMeeting,
    deleteMeeting,
  };
}
