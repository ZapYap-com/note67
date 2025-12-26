import { useState, useEffect, useCallback, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { aiApi } from "../api";
import { useOllamaStore } from "../stores/ollamaStore";
import type { Summary, SummaryType } from "../types";

interface SummaryStreamEvent {
  note_id: string;
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

export function useSummaries(noteId: string | null, refreshKey: number = 0) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);

  // Set up streaming event listener
  useEffect(() => {
    const setupListener = async () => {
      unlistenRef.current = await listen<SummaryStreamEvent>(
        "summary-stream",
        (event) => {
          const { note_id, chunk, is_done } = event.payload;

          // Only process events for the current note
          if (note_id !== currentNoteIdRef.current) return;

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
    if (!noteId) {
      setSummaries([]);
      return;
    }
    try {
      const data = await aiApi.getNoteSummaries(noteId);
      setSummaries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [noteId]);

  // Reload summaries when noteId or refreshKey changes
  useEffect(() => {
    loadSummaries();
  }, [loadSummaries, refreshKey]);

  const generateSummary = useCallback(
    async (summaryType: SummaryType, customPrompt?: string) => {
      if (!noteId) {
        setError("No note selected");
        return null;
      }

      try {
        setIsGenerating(true);
        setStreamingContent("");
        setError(null);
        currentNoteIdRef.current = noteId;

        // Use streaming API
        const summary = await aiApi.generateSummaryStream(
          noteId,
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
        currentNoteIdRef.current = null;
      }
    },
    [noteId]
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
