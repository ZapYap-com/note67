import { useState, useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { aiApi } from "../api";

interface AIWriteStreamEvent {
  chunk: string;
  is_done: boolean;
}

export function useAIWriting() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Set up event listener for streaming
  useEffect(() => {
    const setupListener = async () => {
      unlistenRef.current = await listen<AIWriteStreamEvent>(
        "ai-write-stream",
        (event) => {
          const { chunk, is_done } = event.payload;

          if (is_done) {
            // Generation complete - streamingContent already has the full text
            setIsGenerating(false);
          } else {
            setStreamingContent((prev) => prev + chunk);
          }
        }
      );
    };

    setupListener().catch(console.error);

    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const generate = useCallback(
    async (content: string, action: string, noteContent?: string) => {
      if (isGenerating) return;

      setIsGenerating(true);
      setStreamingContent("");
      setError(null);

      try {
        await aiApi.aiWriteStream(content, action, noteContent);
      } catch (err) {
        console.error("AI writing error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setIsGenerating(false);
      }
    },
    [isGenerating]
  );

  const reset = useCallback(() => {
    setStreamingContent("");
    setError(null);
  }, []);

  return {
    isGenerating,
    streamingContent,
    error,
    generate,
    reset,
  };
}
