import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SystemStatus {
  micAvailable: boolean;
  micPermission: boolean;
  systemAudioSupported: boolean;
  systemAudioPermission: boolean;
  loading: boolean;
}

export function useSystemStatus(): SystemStatus {
  const [status, setStatus] = useState<SystemStatus>({
    micAvailable: true,
    micPermission: true,
    systemAudioSupported: false,
    systemAudioPermission: true,
    loading: true,
  });

  useEffect(() => {
    const checkStatus = async () => {
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

        setStatus({
          micAvailable,
          micPermission,
          systemAudioSupported,
          systemAudioPermission,
          loading: false,
        });
      } catch (err) {
        console.error("Failed to check system status:", err);
        setStatus((prev) => ({ ...prev, loading: false }));
      }
    };

    checkStatus();
  }, []);

  return status;
}
