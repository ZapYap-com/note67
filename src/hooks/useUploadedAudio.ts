import { useState, useEffect, useCallback } from "react";
import { uploadApi } from "../api";
import type { UploadedAudio } from "../types";

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * A note's uploaded audio. `error` is a sentence ready to show: it says which
 * action failed, because upload, delete and transcribe share it.
 */
export function useUploadedAudio(noteId: string | null) {
  const [uploads, setUploads] = useState<UploadedAudio[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which note's uploads are loaded so `isLoading` can be derived rather
  // than set synchronously inside the load effect (avoids cascading renders).
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const isLoading = noteId != null && noteId !== loadedNoteId;

  const loadUploads = useCallback(async () => {
    if (!noteId) return;
    try {
      const data = await uploadApi.getUploads(noteId);
      setUploads(data);
      setLoadedNoteId(noteId);
    } catch (err) {
      setError(`Couldn't load this note's audio files. ${errorText(err)}`);
    }
  }, [noteId]);

  // Reload uploads when noteId changes. The fetch is inlined (rather than
  // calling loadUploads) so setState only happens in the async continuation.
  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    uploadApi
      .getUploads(noteId)
      .then((data) => {
        if (cancelled) return;
        setUploads(data);
        setLoadedNoteId(noteId);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Couldn't load this note's audio files. ${errorText(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const uploadAudio = useCallback(
    async (speakerLabel?: string) => {
      if (!noteId) {
        setError("No note selected");
        return null;
      }

      try {
        setIsUploading(true);
        setError(null);
        const upload = await uploadApi.selectAndUpload(noteId, speakerLabel);
        if (upload) {
          setUploads((prev) => [...prev, upload]);
        }
        return upload;
      } catch (err) {
        setError(`Couldn't upload that file. ${errorText(err)}`);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [noteId]
  );

  const deleteUpload = useCallback(async (uploadId: number) => {
    try {
      await uploadApi.delete(uploadId);
      setUploads((prev) => prev.filter((u) => u.id !== uploadId));
    } catch (err) {
      setError(`Couldn't delete that file. ${errorText(err)}`);
    }
  }, []);

  const transcribeUpload = useCallback(
    async (uploadId: number) => {
      try {
        setIsTranscribing(true);
        setError(null);

        // Update local status to processing
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, transcription_status: "processing" as const } : u
          )
        );

        const segmentCount = await uploadApi.transcribe(uploadId);

        // Update local status to completed
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, transcription_status: "completed" as const } : u
          )
        );

        return segmentCount;
      } catch (err) {
        setError(`Couldn't transcribe that file. ${errorText(err)}`);

        // Update local status to failed
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, transcription_status: "failed" as const } : u
          )
        );

        return 0;
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    uploads,
    isLoading,
    isUploading,
    isTranscribing,
    error,
    clearError,
    loadUploads,
    uploadAudio,
    deleteUpload,
    transcribeUpload,
  };
}
