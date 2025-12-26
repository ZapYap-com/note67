import { useState, useEffect, useCallback } from "react";
import { aiApi } from "../api";
import { useOllamaStore } from "../stores/ollamaStore";
import type { Summary, SummaryType } from "../types";

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
