import { useCallback, useEffect, useState } from "react";
import { transcriptionApi } from "../api";
import { useWhisperStore } from "../stores/whisperStore";
import type {
  ModelInfo,
  ModelSize,
  TranscriptSegment,
  TranscriptionResult,
} from "../types";

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
  const store = useWhisperStore();

  // Initialize on first mount
  useEffect(() => {
    store.refreshModels();
  }, []);

  return {
    models: store.models,
    loadedModel: store.loadedModel,
    isDownloading: store.isDownloading,
    downloadProgress: store.downloadProgress,
    error: store.error,
    refreshModels: store.refreshModels,
    downloadModel: store.downloadModel,
    deleteModel: store.deleteModel,
    loadModel: store.loadModel,
  };
}

interface UseTranscriptionReturn {
  isTranscribing: boolean;
  transcript: TranscriptSegment[];
  error: string | null;
  transcribe: (audioPath: string, meetingId: string) => Promise<TranscriptionResult | null>;
  loadTranscript: (meetingId: string) => Promise<void>;
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

  const loadTranscript = useCallback(async (meetingId: string) => {
    try {
      setError(null);
      const segments = await transcriptionApi.getTranscript(meetingId);
      setTranscript(segments);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
