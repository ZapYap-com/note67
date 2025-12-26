import { useState, useEffect, useCallback } from "react";
import { aiApi } from "../api";
import type { OllamaStatus, Summary, SummaryType } from "../types";

export function useOllama() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      const status = await aiApi.getOllamaStatus();
      setStatus(status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const selectModel = useCallback(async (modelName: string) => {
    try {
      await aiApi.selectModel(modelName);
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [checkStatus]);

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
