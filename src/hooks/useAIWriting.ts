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
    let isMounted = true;
    console.log("[useAIWriting] Setting up listener");

    const setupListener = async () => {
      // Clean up any existing listener first
      if (unlistenRef.current) {
        console.log("[useAIWriting] Cleaning up existing listener");
        unlistenRef.current();
        unlistenRef.current = null;
      }

      unlistenRef.current = await listen<AIWriteStreamEvent>(
        "ai-write-stream",
        (event) => {
          if (!isMounted) return;

          const { chunk, is_done } = event.payload;
          console.log("[useAIWriting] Received chunk:", chunk.substring(0, 20), "done:", is_done);

          if (is_done) {
            setIsGenerating(false);
          } else {
            setStreamingContent((prev) => prev + chunk);
          }
        }
      );
      console.log("[useAIWriting] Listener registered");
    };

    setupListener().catch(console.error);

    return () => {
      console.log("[useAIWriting] Cleanup");
      isMounted = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
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
