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
      const [micAvailable, micPermission, systemAudioSupported] = await Promise.all([
        invoke<boolean>("has_microphone_available"),
        invoke<boolean>("has_microphone_permission"),
        invoke<boolean>("is_system_audio_supported"),
      ]);

      let systemAudioPermission = true;
      if (systemAudioSupported) {
        systemAudioPermission = await invoke<boolean>("has_system_audio_permission");
      }

      const newStatus = {
        micAvailable,
        micPermission,
        systemAudioSupported,
        systemAudioPermission,
        loading: false,
      };

      setStatus(newStatus);
      return newStatus;
    } catch (err) {
      console.error("Failed to check system status:", err);
      const errorStatus = { ...status, loading: false };
      setStatus(errorStatus);
      return errorStatus;
    }
  }, [status]);

  useEffect(() => {
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...status, refresh: checkStatus };
}
