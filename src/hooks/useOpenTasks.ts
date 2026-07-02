import { useCallback, useEffect, useState } from "react";
import { tasksApi } from "../api";
import type { ActionItemWithNote } from "../types";

/**
 * Loads all open action items across every note for the global Tasks view.
 * `refreshKey` lets callers force a reload (e.g. after editing a note).
 */
export function useOpenTasks(refreshKey: number = 0) {
  const [tasks, setTasks] = useState<ActionItemWithNote[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await tasksApi.listAllOpen();
      setTasks(data);
    } catch (error) {
      console.error("Failed to load tasks:", error);
    }
  }, []);

  // Load (and reload on refreshKey). Inlined so setState only runs post-await.
  useEffect(() => {
    let cancelled = false;
    tasksApi
      .listAllOpen()
      .then((data) => {
        if (!cancelled) setTasks(data);
      })
      .catch((error) => {
        console.error("Failed to load tasks:", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { tasks, loading, refresh };
}
