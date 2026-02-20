import { useCallback, useEffect, useState } from "react";
import { notesApi } from "../api";
import type { Note, UpdateNote } from "../types";
import { deleteNoteAttachments } from "../utils/imageUploader";

interface UseNotesReturn {
  notes: Note[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  isSearching: boolean;
  refresh: () => Promise<void>;
  createNote: (title: string, description?: string, participants?: string) => Promise<Note>;
  updateNote: (id: string, update: UpdateNote) => Promise<Note>;
  searchNotes: (query: string) => Promise<void>;
  clearSearch: () => void;
  endNote: (id: string, audioPath?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

export function useNotes(): UseNotesReturn {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSearchQuery("");
      const data = await notesApi.list();
      setNotes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const createNote = useCallback(
    async (title: string, description?: string, participants?: string): Promise<Note> => {
      const note = await notesApi.create({ title, description, participants });
      setNotes((prev) => [note, ...prev]);
      return note;
    },
    []
  );

  const updateNote = useCallback(
    async (id: string, update: UpdateNote): Promise<Note> => {
      const updated = await notesApi.update(id, update);
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      return updated;
    },
    []
  );

  const searchNotes = useCallback(async (query: string): Promise<void> => {
    if (!query.trim()) {
      await refresh();
      return;
    }
    try {
      setIsSearching(true);
      setSearchQuery(query);
      setError(null);
      const results = await notesApi.search(query);
      setNotes(results);
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

  const endNote = useCallback(async (id: string, audioPath?: string): Promise<void> => {
    await notesApi.end(id, audioPath);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, ended_at: new Date().toISOString(), audio_path: audioPath ?? null } : n
      )
    );
  }, []);

  const deleteNote = useCallback(async (id: string): Promise<void> => {
    await notesApi.delete(id);
    // Also delete any attachments for this note
    await deleteNoteAttachments(id).catch(() => {
      // Ignore errors - attachments folder may not exist
    });
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    notes,
    loading,
    error,
    searchQuery,
    isSearching,
    refresh,
    createNote,
    updateNote,
    searchNotes,
    clearSearch,
    endNote,
    deleteNote,
  };
}
