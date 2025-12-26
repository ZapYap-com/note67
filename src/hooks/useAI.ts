import { useState, useEffect, useCallback, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { aiApi } from "../api";
import { useOllamaStore } from "../stores/ollamaStore";
import type { Summary, SummaryType } from "../types";

interface SummaryStreamEvent {
  meeting_id: string;
  chunk: string;
  is_done: boolean;
}

export function useOllama() {
  // Subscribe to specific state values for proper reactivity
  const status = useOllamaStore((state) => state.status);
  const loading = useOllamaStore((state) => state.loading);
  const error = useOllamaStore((state) => state.error);
  const checkStatus = useOllamaStore((state) => state.checkStatus);
  const selectModel = useOllamaStore((state) => state.selectModel);

  // Initialize on first mount - checkStatus will auto-restore saved model
  useEffect(() => {
    checkStatus();
  }, []);

  return {
    status,
    loading,
    error,
    isRunning: status?.running ?? false,
    models: status?.models ?? [],
    selectedModel: status?.selected_model ?? null,
    checkStatus,
    selectModel,
  };
}

export function useSummaries(meetingId: string | null) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const currentMeetingIdRef = useRef<string | null>(null);

  // Set up streaming event listener
  useEffect(() => {
    const setupListener = async () => {
      unlistenRef.current = await listen<SummaryStreamEvent>(
        "summary-stream",
        (event) => {
          const { meeting_id, chunk, is_done } = event.payload;

          // Only process events for the current meeting
          if (meeting_id !== currentMeetingIdRef.current) return;

          if (is_done) {
            setStreamingContent("");
          } else {
            setStreamingContent((prev) => prev + chunk);
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

  const loadSummaries = useCallback(async () => {
    if (!meetingId) {
      setSummaries([]);
      return;
    }
    try {
      const data = await aiApi.getMeetingSummaries(meetingId);
      setSummaries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [meetingId]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  const generateSummary = useCallback(
    async (summaryType: SummaryType, customPrompt?: string) => {
      if (!meetingId) {
        setError("No meeting selected");
        return null;
      }

      try {
        setIsGenerating(true);
        setStreamingContent("");
        setError(null);
        currentMeetingIdRef.current = meetingId;

        // Use streaming API
        const summary = await aiApi.generateSummaryStream(
          meetingId,
          summaryType,
          customPrompt
        );
        setSummaries((prev) => [summary, ...prev]);
        setStreamingContent("");
        return summary;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setIsGenerating(false);
        currentMeetingIdRef.current = null;
      }
    },
    [meetingId]
  );

  const deleteSummary = useCallback(async (summaryId: number) => {
    try {
      await aiApi.deleteSummary(summaryId);
      setSummaries((prev) => prev.filter((s) => s.id !== summaryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    summaries,
    isGenerating,
    streamingContent,
    error,
    loadSummaries,
    generateSummary,
    deleteSummary,
  };
}
