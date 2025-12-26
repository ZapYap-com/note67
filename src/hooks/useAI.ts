import { useState, useEffect, useCallback } from "react";
import { aiApi } from "../api";
import { useOllamaStore } from "../stores/ollamaStore";
import type { Summary, SummaryType } from "../types";

export function useOllama() {
  const store = useOllamaStore();

  // Initialize on first mount
  useEffect(() => {
    if (store.status === null && !store.loading) {
      store.checkStatus();
    }
  }, []);

  // Initial load
  useEffect(() => {
    store.checkStatus();
  }, []);

  return {
    status: store.status,
    loading: store.loading,
    error: store.error,
    isRunning: store.isRunning(),
    models: store.models(),
    selectedModel: store.selectedModel(),
    checkStatus: store.checkStatus,
    selectModel: store.selectModel,
  };
}

export function useSummaries(meetingId: string | null) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(null);
        const summary = await aiApi.generateSummary(
          meetingId,
          summaryType,
          customPrompt
        );
        setSummaries((prev) => [summary, ...prev]);
        return summary;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setIsGenerating(false);
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
    error,
    loadSummaries,
    generateSummary,
    deleteSummary,
  };
}
