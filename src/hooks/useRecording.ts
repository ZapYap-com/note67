import { useCallback, useEffect, useRef, useState } from "react";
import { audioApi } from "../api";

interface UseRecordingReturn {
  isRecording: boolean;
  audioLevel: number;
  audioPath: string | null;
  error: string | null;
  startRecording: (meetingId: string) => Promise<void>;
  stopRecording: () => Promise<void>;
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const levelIntervalRef = useRef<number | null>(null);

  const startRecording = useCallback(async (meetingId: string) => {
    try {
      setError(null);
      const path = await audioApi.startRecording(meetingId);
      setAudioPath(path);
      setIsRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      setError(null);
      const path = await audioApi.stopRecording();
      setAudioPath(path);
      setIsRecording(false);
      setAudioLevel(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Poll audio level while recording
  useEffect(() => {
    if (isRecording) {
      levelIntervalRef.current = window.setInterval(async () => {
        try {
          const level = await audioApi.getAudioLevel();
          setAudioLevel(level);
        } catch {
          // Ignore errors during polling
        }
      }, 100);
    } else {
      if (levelIntervalRef.current) {
        clearInterval(levelIntervalRef.current);
        levelIntervalRef.current = null;
      }
    }

    return () => {
      if (levelIntervalRef.current) {
        clearInterval(levelIntervalRef.current);
      }
    };
  }, [isRecording]);

  // Check initial recording status
  useEffect(() => {
    audioApi.getRecordingStatus().then(setIsRecording).catch(console.error);
  }, []);

  return {
    isRecording,
    audioLevel,
    audioPath,
    error,
    startRecording,
    stopRecording,
  };
}
