import { useCallback, useEffect, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { transcriptionApi } from "../api";
import type { DualTranscriptionResult } from "../api/transcription";
import { useWhisperStore } from "../stores/whisperStore";
import type {
  ModelInfo,
  ModelSize,
  TranscriptSegment,
  TranscriptionResult,
} from "../types";

interface TranscriptionUpdateEvent {
  note_id: string;
  segments: Array<{
    start_time: number;
    end_time: number;
    text: string;
  }>;
  is_final: boolean;
  audio_source?: "mic" | "system";
}

interface UseModelsReturn {
  models: ModelInfo[];
  loadedModel: ModelSize | null;
  isDownloading: boolean;
  downloadingModel: ModelSize | null;
  downloadProgress: number;
  error: string | null;
  refreshModels: () => Promise<void>;
  downloadModel: (size: ModelSize) => Promise<void>;
  deleteModel: (size: ModelSize) => Promise<void>;
  loadModel: (size: ModelSize) => Promise<void>;
}

export function useModels(): UseModelsReturn {
  // Subscribe to specific state values for proper reactivity
  const models = useWhisperStore((state) => state.models);
  const loadedModel = useWhisperStore((state) => state.loadedModel);
  const isDownloading = useWhisperStore((state) => state.isDownloading);
  const downloadingModel = useWhisperStore((state) => state.downloadingModel);
  const downloadProgress = useWhisperStore((state) => state.downloadProgress);
  const error = useWhisperStore((state) => state.error);
  const refreshModels = useWhisperStore((state) => state.refreshModels);
  const downloadModel = useWhisperStore((state) => state.downloadModel);
  const deleteModel = useWhisperStore((state) => state.deleteModel);
  const loadModel = useWhisperStore((state) => state.loadModel);
  const loadSettings = useWhisperStore((state) => state.loadSettings);

  // Initialize on first mount - load settings first, then refreshModels will auto-load saved model
  useEffect(() => {
    loadSettings().then(() => refreshModels());
  }, []);

  return {
    models,
    loadedModel,
    isDownloading,
    downloadingModel,
    downloadProgress,
    error,
    refreshModels,
    downloadModel,
    deleteModel,
    loadModel,
  };
}

interface UseTranscriptionReturn {
  isTranscribing: boolean;
  transcript: TranscriptSegment[];
  error: string | null;
  transcribe: (audioPath: string, noteId: string) => Promise<TranscriptionResult | null>;
  /** Transcribe dual audio files (mic + system) with speaker labels */
  transcribeDual: (
    micPath: string,
    systemPath: string | null,
    noteId: string
  ) => Promise<DualTranscriptionResult | null>;
  loadTranscript: (noteId: string) => Promise<TranscriptSegment[]>;
}

export function useTranscription(): UseTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(
    async (audioPath: string, noteId: string): Promise<TranscriptionResult | null> => {
      try {
        setError(null);
        setIsTranscribing(true);
        const result = await transcriptionApi.transcribeAudio(audioPath, noteId);
        // Convert result segments to TranscriptSegment format
        const segments: TranscriptSegment[] = result.segments.map((s, idx) => ({
          id: idx,
          note_id: noteId,
          start_time: s.start_time,
          end_time: s.end_time,
          text: s.text,
          speaker: null,
          created_at: new Date().toISOString(),
        }));
        setTranscript(segments);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const transcribeDual = useCallback(
    async (
      micPath: string,
      systemPath: string | null,
      noteId: string
    ): Promise<DualTranscriptionResult | null> => {
      try {
        setError(null);
        setIsTranscribing(true);
        const result = await transcriptionApi.transcribeDualAudio(
          micPath,
          systemPath,
          noteId
        );

        // Load the transcript from database (includes both "You" and "Others" segments)
        const segments = await transcriptionApi.getTranscript(noteId);
        setTranscript(segments);

        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const loadTranscript = useCallback(async (noteId: string): Promise<TranscriptSegment[]> => {
    try {
      setError(null);
      const segments = await transcriptionApi.getTranscript(noteId);
      setTranscript(segments);
      return segments;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, []);

  // Check initial transcribing status
  useEffect(() => {
    transcriptionApi.isTranscribing().then(setIsTranscribing).catch(console.error);
  }, []);

  return {
    isTranscribing,
    transcript,
    error,
    transcribe,
    transcribeDual,
    loadTranscript,
  };
}

// Helper to merge consecutive segments from the same speaker
function mergeConsecutiveSameSpeaker(
  segments: TranscriptSegment[],
  speaker: string
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const result: TranscriptSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.speaker === speaker && current.speaker === speaker) {
      // Merge with current
      current = {
        ...current,
        end_time: seg.end_time,
        text: current.text + " " + seg.text,
      };
    } else {
      result.push(current);
      current = { ...seg };
    }
  }
  result.push(current);
  return result;
}

interface UseLiveTranscriptionReturn {
  isLiveTranscribing: boolean;
  liveSegments: TranscriptSegment[];
  error: string | null;
  startLiveTranscription: (noteId: string, speakerName?: string) => Promise<void>;
  stopLiveTranscription: (noteId: string) => Promise<TranscriptionResult | null>;
}

export function useLiveTranscription(): UseLiveTranscriptionReturn {
  const [isLiveTranscribing, setIsLiveTranscribing] = useState(false);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const speakerNameRef = useRef<string>("Me");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Set up event listener
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      const unlistenFn = await listen<TranscriptionUpdateEvent>(
        "transcription-update",
        (event) => {
          // Ignore events if effect was cleaned up (StrictMode double-mount)
          if (cancelled) return;

          const { note_id, segments, is_final, audio_source } = event.payload;

          // Only process events for the current note
          if (note_id !== currentNoteIdRef.current) return;

          // Set speaker based on audio source: mic = user's name, system = "Others"
          const speaker = audio_source === "system" ? "Others" : speakerNameRef.current;

          setLiveSegments((prev) => {
            // Convert new segments
            const newSegments: TranscriptSegment[] = segments.map((s, idx) => ({
              id: Date.now() + idx,
              note_id,
              start_time: s.start_time,
              end_time: s.end_time,
              text: s.text,
              speaker,
              created_at: new Date().toISOString(),
            }));

            if (newSegments.length === 0) return prev;

            // Merge with previous if same speaker
            const lastPrev = prev[prev.length - 1];
            const firstNew = newSegments[0];

            if (lastPrev && lastPrev.speaker === firstNew.speaker) {
              // Merge the first new segment with the last previous segment
              const merged: TranscriptSegment = {
                ...lastPrev,
                end_time: firstNew.end_time,
                text: lastPrev.text + " " + firstNew.text,
              };
              // Merge consecutive same-speaker segments in newSegments
              const mergedNew = mergeConsecutiveSameSpeaker(newSegments.slice(1), speaker);
              return [...prev.slice(0, -1), merged, ...mergedNew];
            } else {
              // Merge consecutive same-speaker segments in newSegments
              const mergedNew = mergeConsecutiveSameSpeaker(newSegments, speaker);
              return [...prev, ...mergedNew];
            }
          });

          if (is_final) {
            setIsLiveTranscribing(false);
          }
        }
      );

      // If effect was cancelled during async setup, clean up immediately
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
        unlistenRef.current = unlistenFn;
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const startLiveTranscription = useCallback(async (noteId: string, speakerName?: string) => {
    try {
      setError(null);
      setLiveSegments([]);
      currentNoteIdRef.current = noteId;
      speakerNameRef.current = speakerName || "Me";
      // Get language from store - "auto" becomes undefined for backend
      const language = useWhisperStore.getState().language;
      const langParam = language === "auto" ? undefined : language;
      await transcriptionApi.startLiveTranscription(noteId, langParam);
      setIsLiveTranscribing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      currentNoteIdRef.current = null;
    }
  }, []);

  const stopLiveTranscription = useCallback(async (noteId: string): Promise<TranscriptionResult | null> => {
    try {
      setError(null);
      const result = await transcriptionApi.stopLiveTranscription(noteId);
      setIsLiveTranscribing(false);
      currentNoteIdRef.current = null;
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  // Check initial status
  useEffect(() => {
    transcriptionApi.isLiveTranscribing().then(setIsLiveTranscribing).catch(console.error);
  }, []);

  return {
    isLiveTranscribing,
    liveSegments,
    error,
    startLiveTranscription,
    stopLiveTranscription,
  };
}
