import { useCallback, useEffect, useRef, useState } from "react";
import { transcriptionApi } from "../api";
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadedModel, setLoadedModel] = useState<ModelSize | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const [modelList, loaded] = await Promise.all([
        transcriptionApi.listModels(),
        transcriptionApi.getLoadedModel(),
      ]);
      setModels(modelList);
      setLoadedModel(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const downloadModel = useCallback(
    async (size: ModelSize) => {
      try {
        setError(null);
        setIsDownloading(true);
        setDownloadProgress(0);

        // Start polling progress
        progressIntervalRef.current = window.setInterval(async () => {
          try {
            const progress = await transcriptionApi.getDownloadProgress();
            setDownloadProgress(progress);
          } catch {
            // Ignore errors during polling
          }
        }, 500);

        await transcriptionApi.downloadModel(size);
        await refreshModels();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsDownloading(false);
        setDownloadProgress(0);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
      }
    },
    [refreshModels]
  );

  const deleteModel = useCallback(
    async (size: ModelSize) => {
      try {
        setError(null);
        await transcriptionApi.deleteModel(size);
        await refreshModels();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshModels]
  );

  const loadModel = useCallback(
    async (size: ModelSize) => {
      try {
        setError(null);
        await transcriptionApi.loadModel(size);
        setLoadedModel(size);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    []
  );

  // Load initial data
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
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
