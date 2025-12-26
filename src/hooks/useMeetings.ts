import { useCallback, useEffect, useState } from "react";
import { meetingsApi } from "../api";
import type { Meeting, UpdateMeeting } from "../types";

interface UseMeetingsReturn {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  isSearching: boolean;
  refresh: () => Promise<void>;
  createMeeting: (title: string, description?: string, participants?: string) => Promise<Meeting>;
  updateMeeting: (id: string, update: UpdateMeeting) => Promise<Meeting>;
  searchMeetings: (query: string) => Promise<void>;
  clearSearch: () => void;
  endMeeting: (id: string, audioPath?: string) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
}

export function useMeetings(): UseMeetingsReturn {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSearchQuery("");
      const data = await meetingsApi.list();
      setMeetings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const createMeeting = useCallback(
    async (title: string, description?: string, participants?: string): Promise<Meeting> => {
      const meeting = await meetingsApi.create({ title, description, participants });
      setMeetings((prev) => [meeting, ...prev]);
      return meeting;
    },
    []
  );

  const updateMeeting = useCallback(
    async (id: string, update: UpdateMeeting): Promise<Meeting> => {
      const updated = await meetingsApi.update(id, update);
      setMeetings((prev) => prev.map((m) => (m.id === id ? updated : m)));
      return updated;
    },
    []
  );

  const searchMeetings = useCallback(async (query: string): Promise<void> => {
    if (!query.trim()) {
      await refresh();
      return;
    }
    try {
      setIsSearching(true);
      setSearchQuery(query);
      setError(null);
      const results = await meetingsApi.search(query);
      setMeetings(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSearching(false);
    }
  }, [refresh]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    refresh();
  }, [refresh]);

  const endMeeting = useCallback(async (id: string, audioPath?: string): Promise<void> => {
    await meetingsApi.end(id, audioPath);
    setMeetings((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, ended_at: new Date().toISOString(), audio_path: audioPath ?? null } : m
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
    searchQuery,
    isSearching,
    refresh,
    createMeeting,
    updateMeeting,
    searchMeetings,
    clearSearch,
    endMeeting,
    deleteMeeting,
  };
}
