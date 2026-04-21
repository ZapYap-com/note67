import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useGraphStore } from "../stores/graphStore";

export function useGraphUpdates() {
  const { fetchGraphData, viewMode, localCenterNoteId, fetchLocalGraph } =
    useGraphStore();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let mounted = true;
    const unlisteners: (() => void)[] = [];

    const refresh = () => {
      if (!mounted) return;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Debounce to avoid too many refreshes
      timeoutRef.current = setTimeout(() => {
        if (!mounted) return;

        if (viewMode === "local" && localCenterNoteId) {
          fetchLocalGraph(localCenterNoteId);
        } else {
          fetchGraphData();
        }
      }, 1000);
    };

    // Listen for note change events
    const events = [
      "note-created",
      "note-updated",
      "note-deleted",
      "note-links-changed",
    ];

    events.forEach((eventName) => {
      listen(eventName, refresh).then((unlisten) => {
        if (mounted) {
          unlisteners.push(unlisten);
        } else {
          unlisten();
        }
      });
    });

    return () => {
      mounted = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [fetchGraphData, fetchLocalGraph, viewMode, localCenterNoteId]);
}
