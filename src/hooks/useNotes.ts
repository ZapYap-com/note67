import { useCallback, useEffect, useState } from "react";
import { notesApi } from "../api";
import type { Note, UpdateNote } from "../types";
import { deleteNoteAttachments } from "../utils/imageUploader";

interface UseNotesReturn {
  notes: Note[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createNote: (title: string, description?: string, participants?: string) => Promise<Note>;
  updateNote: (id: string, update: UpdateNote) => Promise<Note>;
  endNote: (id: string, audioPath?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

export function useNotes(): UseNotesReturn {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
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

  // Initial load. Inlined (rather than calling refresh) so setState only runs
  // in the async continuation, not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    notesApi
      .list()
      .then((data) => {
        if (!cancelled) setNotes(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    notes,
    loading,
    error,
    refresh,
    createNote,
    updateNote,
    endNote,
    deleteNote,
  };
}
