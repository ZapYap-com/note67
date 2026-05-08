import { useCallback, useEffect, useRef, useState } from "react";
import { audioApi } from "../api";
import { RecordingPhase } from "../types";

export type RecordingMode = "idle" | "dual" | "mic-only" | "system-only";

interface UseRecordingReturn {
  isRecording: boolean;
  isPaused: boolean;
  recordingPhase: RecordingPhase;
  audioLevel: number;
  audioPath: string | null;
  error: string | null;
  isDualRecording: boolean;
  /** Active recording mode. "system-only" means listen-only (no mic). */
  recordingMode: RecordingMode;
  startRecording: (noteId: string) => Promise<void>;
  stopRecording: (noteId?: string) => Promise<string | null>;
  pauseRecording: () => Promise<void>;
  resumeRecording: (noteId: string) => Promise<void>;
  continueRecording: (noteId: string) => Promise<void>;
}

async function detectInputs(): Promise<{ micOk: boolean; systemOk: boolean }> {
  const [micAvailable, micPermission, systemSupported] = await Promise.all([
    audioApi.hasMicrophoneAvailable(),
    audioApi.hasMicrophonePermission(),
    audioApi.isSystemAudioSupported(),
  ]);
  const systemPermission = systemSupported
    ? await audioApi.hasSystemAudioPermission()
    : false;
  return {
    micOk: micAvailable && micPermission,
    systemOk: systemSupported && systemPermission,
  };
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
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("idle");
  const levelIntervalRef = useRef<number | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);

  const startRecording = useCallback(async (noteId: string) => {
    try {
      setError(null);
      currentNoteIdRef.current = noteId;

      const { micOk, systemOk } = await detectInputs();

      if (micOk && systemOk) {
        console.log("Starting dual recording (mic + system audio)");
        const result = await audioApi.startDualRecordingWithSegments(noteId);
        setAudioPath(
          result.playbackPath || result.systemPath || result.micPath
        );
        setRecordingMode("dual");
      } else if (micOk) {
        console.log("Starting mic-only recording");
        const path = await audioApi.startRecording(noteId);
        setAudioPath(path);
        setRecordingMode("mic-only");
      } else if (systemOk) {
        console.log("Starting listen-only recording (system audio only)");
        const result = await audioApi.startSystemOnlyRecordingWithSegments(
          noteId
        );
        setAudioPath(result.systemPath);
        setRecordingMode("system-only");
      } else {
        throw new Error(
          "No audio input available. Grant microphone or system audio permission to record."
        );
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

        if (recordingMode === "dual" && id) {
          console.log("Stopping dual recording with segments");
          const result = await audioApi.stopDualRecordingWithSegments(id);
          path = result.playbackPath || result.systemPath || result.micPath;
        } else if (recordingMode === "system-only" && id) {
          console.log("Stopping listen-only recording");
          const result = await audioApi.stopSystemOnlyRecordingWithSegments(id);
          path = result.playbackPath || result.systemPath;
        } else {
          console.log("Stopping mic-only recording");
          path = await audioApi.stopRecording();
        }

        setAudioPath(path);
        setIsRecording(false);
        setIsPaused(false);
        setRecordingPhase(RecordingPhase.Idle);
        setRecordingMode("idle");
        setAudioLevel(0);
        currentNoteIdRef.current = null;
        return path;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [recordingMode]
  );

  const pauseRecording = useCallback(async () => {
    try {
      setError(null);
      if (recordingMode === "system-only") {
        console.log("Pausing listen-only recording");
        await audioApi.pauseSystemOnlyRecording();
      } else {
        console.log("Pausing dual recording");
        await audioApi.pauseDualRecording();
      }
      setIsRecording(false);
      setIsPaused(true);
      setRecordingPhase(RecordingPhase.Paused);
      setAudioLevel(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [recordingMode]);

  const resumeRecording = useCallback(
    async (noteId: string) => {
      try {
        setError(null);
        if (recordingMode === "system-only") {
          console.log("Resuming listen-only recording");
          const result = await audioApi.resumeSystemOnlyRecording(noteId);
          setAudioPath(result.systemPath);
        } else {
          console.log("Resuming dual recording");
          const result = await audioApi.resumeDualRecording(noteId);
          setAudioPath(
            result.playbackPath || result.systemPath || result.micPath
          );
          setRecordingMode(result.systemPath !== null ? "dual" : "mic-only");
        }
        setIsRecording(true);
        setIsPaused(false);
        setRecordingPhase(RecordingPhase.Recording);
        currentNoteIdRef.current = noteId;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [recordingMode]
  );

  const continueRecording = useCallback(async (noteId: string) => {
    try {
      setError(null);
      const { micOk, systemOk } = await detectInputs();

      if (!micOk && systemOk) {
        console.log("Continuing in listen-only mode (mic unavailable)");
        const result = await audioApi.startSystemOnlyRecordingWithSegments(
          noteId
        );
        setAudioPath(result.systemPath);
        setRecordingMode("system-only");
      } else if (micOk) {
        console.log("Continuing recording on ended note");
        const result = await audioApi.continueNoteRecording(noteId);
        setAudioPath(
          result.playbackPath || result.systemPath || result.micPath
        );
        setRecordingMode(result.systemPath !== null ? "dual" : "mic-only");
      } else {
        throw new Error(
          "No audio input available. Grant microphone or system audio permission to record."
        );
      }
      setIsRecording(true);
      setIsPaused(false);
      setRecordingPhase(RecordingPhase.Recording);
      currentNoteIdRef.current = noteId;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
    isDualRecording: recordingMode === "dual",
    recordingMode,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    continueRecording,
  };
}
