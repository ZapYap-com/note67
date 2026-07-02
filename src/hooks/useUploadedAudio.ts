import { useState, useEffect, useCallback } from "react";
import { uploadApi } from "../api";
import type { UploadedAudio } from "../types";

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
      setError(err instanceof Error ? err.message : String(err));
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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
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
      setError(err instanceof Error ? err.message : String(err));
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
        const message = err instanceof Error ? err.message : String(err);
        setError(message);

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

  const updateSpeaker = useCallback(
    async (uploadId: number, speakerLabel: string) => {
      try {
        await uploadApi.updateSpeaker(uploadId, speakerLabel);
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, speaker_label: speakerLabel } : u
          )
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  return {
    uploads,
    isLoading,
    isUploading,
    isTranscribing,
    error,
    loadUploads,
    uploadAudio,
    deleteUpload,
    transcribeUpload,
    updateSpeaker,
  };
}
