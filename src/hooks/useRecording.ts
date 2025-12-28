import { useCallback, useEffect, useRef, useState } from "react";
import { audioApi } from "../api";
import { RecordingPhase } from "../types";

interface UseRecordingReturn {
  isRecording: boolean;
  isPaused: boolean;
  recordingPhase: RecordingPhase;
  audioLevel: number;
  audioPath: string | null;
  error: string | null;
  isDualRecording: boolean;
  startRecording: (noteId: string) => Promise<void>;
  stopRecording: (noteId?: string) => Promise<string | null>;
  pauseRecording: () => Promise<void>;
  resumeRecording: (noteId: string) => Promise<void>;
  continueRecording: (noteId: string) => Promise<void>;
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>(
    RecordingPhase.Idle
  );
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDualRecording, setIsDualRecording] = useState(false);
  const levelIntervalRef = useRef<number | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);

  const startRecording = useCallback(async (noteId: string) => {
    try {
      setError(null);
      currentNoteIdRef.current = noteId;

      // Check if system audio is supported and has permission
      const isSupported = await audioApi.isSystemAudioSupported();
      const hasPermission = isSupported
        ? await audioApi.hasSystemAudioPermission()
        : false;

      if (isSupported && hasPermission) {
        // Use dual recording (mic + system audio)
        console.log("Starting dual recording (mic + system audio)");
        const result = await audioApi.startDualRecording(noteId);
        // Use the playback path if available, otherwise mic path
        setAudioPath(result.playbackPath || result.systemPath || result.micPath);
        setIsDualRecording(true);
      } else {
        // Fall back to mic-only recording
        console.log("Starting mic-only recording");
        const path = await audioApi.startRecording(noteId);
        setAudioPath(path);
        setIsDualRecording(false);
      }
      setIsRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stopRecording = useCallback(
    async (noteId?: string): Promise<string | null> => {
      try {
        setError(null);
        const id = noteId || currentNoteIdRef.current;

        let path: string | null = null;

        if (isDualRecording && id) {
          // Stop dual recording
          console.log("Stopping dual recording");
          const result = await audioApi.stopDualRecording(id);
          // Use the merged playback path, or fall back to system path, then mic path
          path = result.playbackPath || result.systemPath || result.micPath;
        } else {
          // Stop mic-only recording
          console.log("Stopping mic-only recording");
          path = await audioApi.stopRecording();
        }

        setAudioPath(path);
        setIsRecording(false);
        setIsPaused(false);
        setRecordingPhase(RecordingPhase.Idle);
        setIsDualRecording(false);
        setAudioLevel(0);
        currentNoteIdRef.current = null;
        return path;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [isDualRecording]
  );

  const pauseRecording = useCallback(async () => {
    try {
      setError(null);
      console.log("Pausing dual recording");
      await audioApi.pauseDualRecording();
      setIsRecording(false);
      setIsPaused(true);
      setRecordingPhase(RecordingPhase.Paused);
      setAudioLevel(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const resumeRecording = useCallback(async (noteId: string) => {
    try {
      setError(null);
      console.log("Resuming dual recording");
      const result = await audioApi.resumeDualRecording(noteId);
      setAudioPath(result.playbackPath || result.systemPath || result.micPath);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingPhase(RecordingPhase.Recording);
      setIsDualRecording(result.systemPath !== null);
      currentNoteIdRef.current = noteId;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const continueRecording = useCallback(async (noteId: string) => {
    try {
      setError(null);
      console.log("Continuing recording on ended note");
      const result = await audioApi.continueNoteRecording(noteId);
      setAudioPath(result.playbackPath || result.systemPath || result.micPath);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingPhase(RecordingPhase.Recording);
      setIsDualRecording(result.systemPath !== null);
      currentNoteIdRef.current = noteId;
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
    isPaused,
    recordingPhase,
    audioLevel,
    audioPath,
    error,
    isDualRecording,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    continueRecording,
  };
}
