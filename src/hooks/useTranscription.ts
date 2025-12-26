import { useCallback, useEffect, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { transcriptionApi } from "../api";
import { useWhisperStore } from "../stores/whisperStore";
import type {
  ModelInfo,
  ModelSize,
  TranscriptSegment,
  TranscriptionResult,
} from "../types";

interface TranscriptionUpdateEvent {
  meeting_id: string;
  segments: Array<{
    start_time: number;
    end_time: number;
    text: string;
  }>;
  is_final: boolean;
}

interface UseModelsReturn {
  models: ModelInfo[];
  loadedModel: ModelSize | null;
  isDownloading: boolean;
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
  const downloadProgress = useWhisperStore((state) => state.downloadProgress);
  const error = useWhisperStore((state) => state.error);
  const refreshModels = useWhisperStore((state) => state.refreshModels);
  const downloadModel = useWhisperStore((state) => state.downloadModel);
  const deleteModel = useWhisperStore((state) => state.deleteModel);
  const loadModel = useWhisperStore((state) => state.loadModel);

  // Initialize on first mount - refreshModels will auto-load saved model
  useEffect(() => {
    refreshModels();
  }, []);

  return {
    models,
    loadedModel,
    isDownloading,
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
  transcribe: (audioPath: string, meetingId: string) => Promise<TranscriptionResult | null>;
  loadTranscript: (meetingId: string) => Promise<TranscriptSegment[]>;
}

export function useTranscription(): UseTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(
    async (audioPath: string, meetingId: string): Promise<TranscriptionResult | null> => {
      try {
        setError(null);
        setIsTranscribing(true);
        const result = await transcriptionApi.transcribeAudio(audioPath, meetingId);
        // Convert result segments to TranscriptSegment format
        const segments: TranscriptSegment[] = result.segments.map((s, idx) => ({
          id: idx,
          meeting_id: meetingId,
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

  const loadTranscript = useCallback(async (meetingId: string): Promise<TranscriptSegment[]> => {
    try {
      setError(null);
      const segments = await transcriptionApi.getTranscript(meetingId);
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
  startLiveTranscription: (meetingId: string, speakerName?: string) => Promise<void>;
  stopLiveTranscription: (meetingId: string) => Promise<TranscriptionResult | null>;
}

export function useLiveTranscription(): UseLiveTranscriptionReturn {
  const [isLiveTranscribing, setIsLiveTranscribing] = useState(false);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const currentMeetingIdRef = useRef<string | null>(null);
  const speakerNameRef = useRef<string>("Me");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Set up event listener
  useEffect(() => {
    const setupListener = async () => {
      unlistenRef.current = await listen<TranscriptionUpdateEvent>(
        "transcription-update",
        (event) => {
          const { meeting_id, segments, is_final } = event.payload;

          // Only process events for the current meeting
          if (meeting_id !== currentMeetingIdRef.current) return;

          const speaker = speakerNameRef.current;

          setLiveSegments((prev) => {
            // Convert new segments
            const newSegments: TranscriptSegment[] = segments.map((s, idx) => ({
              id: Date.now() + idx,
              meeting_id,
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
    };

    setupListener();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  const startLiveTranscription = useCallback(async (meetingId: string, speakerName?: string) => {
    try {
      setError(null);
      setLiveSegments([]);
      currentMeetingIdRef.current = meetingId;
      speakerNameRef.current = speakerName || "Me";
      await transcriptionApi.startLiveTranscription(meetingId);
      setIsLiveTranscribing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      currentMeetingIdRef.current = null;
    }
  }, []);

  const stopLiveTranscription = useCallback(async (meetingId: string): Promise<TranscriptionResult | null> => {
    try {
      setError(null);
      const result = await transcriptionApi.stopLiveTranscription(meetingId);
      setIsLiveTranscribing(false);
      currentMeetingIdRef.current = null;
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
