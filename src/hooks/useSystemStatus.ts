import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SystemStatusData {
  micAvailable: boolean;
  micPermission: boolean;
  systemAudioSupported: boolean;
  systemAudioPermission: boolean;
  loading: boolean;
}

interface SystemStatus extends SystemStatusData {
  refresh: () => Promise<SystemStatusData>;
}

// Query the current system status. Module-level (no React state) so both the
// mount effect and the manual `refresh` can share it without duplicating logic.
async function fetchSystemStatus(): Promise<SystemStatusData> {
  const [micAvailable, micPermission, systemAudioSupported] = await Promise.all([
    invoke<boolean>("has_microphone_available"),
    invoke<boolean>("has_microphone_permission"),
    invoke<boolean>("is_system_audio_supported"),
  ]);

  let systemAudioPermission = true;
  if (systemAudioSupported) {
    systemAudioPermission = await invoke<boolean>("has_system_audio_permission");
  }

  return {
    micAvailable,
    micPermission,
    systemAudioSupported,
    systemAudioPermission,
    loading: false,
  };
}

export function useSystemStatus(): SystemStatus {
  const [status, setStatus] = useState<SystemStatusData>({
    micAvailable: true,
    micPermission: true,
    systemAudioSupported: false,
    systemAudioPermission: true,
    loading: true,
  });

  const checkStatus = useCallback(async (): Promise<SystemStatusData> => {
    try {
      const newStatus = await fetchSystemStatus();
      setStatus(newStatus);
      return newStatus;
    } catch (err) {
      console.error("Failed to check system status:", err);
      const errorStatus = { ...status, loading: false };
      setStatus(errorStatus);
      return errorStatus;
    }
  }, [status]);

  // Initial check. Inlined so setState only runs in the async continuation.
  useEffect(() => {
    let cancelled = false;
    fetchSystemStatus()
      .then((newStatus) => {
        if (!cancelled) setStatus(newStatus);
      })
      .catch((err) => {
        console.error("Failed to check system status:", err);
        if (!cancelled) setStatus((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...status, refresh: checkStatus };
}
