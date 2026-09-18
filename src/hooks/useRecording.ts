import { useCallback, useEffect, useRef } from "react";
import { audioApi } from "../api";
import { RecordingPhase } from "../types";
import { useRecordingStore } from "../stores/recordingStore";
import type { RecordingMode } from "../stores/recordingStore";

export type { RecordingMode };

interface UseRecordingReturn {
  isRecording: boolean;
  isPaused: boolean;
  recordingPhase: RecordingPhase;
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

/**
 * Owns recording: the actions plus the audio-level polling effect.
 *
 * State lives in `useRecordingStore` so components can read it without prop
 * drilling. Call this hook in exactly **one** place (App) — it is the single
 * writer, and mounting it twice would start the polling interval twice.
 * Read-only consumers should subscribe to the store instead.
 */
export function useRecording(): UseRecordingReturn {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isPaused = useRecordingStore((s) => s.isPaused);
  const recordingPhase = useRecordingStore((s) => s.recordingPhase);
  // audioLevel is deliberately not selected here. It changes every 100 ms
  // while recording, and subscribing would re-render the hook's owner (App)
  // at that rate. The level meter reads it from the store itself.
  const audioPath = useRecordingStore((s) => s.audioPath);
  const error = useRecordingStore((s) => s.error);
  const recordingMode = useRecordingStore((s) => s.recordingMode);
  const patch = useRecordingStore((s) => s.patch);

  const levelIntervalRef = useRef<number | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);

  const startRecording = useCallback(
    async (noteId: string) => {
      try {
        patch({ error: null });
        currentNoteIdRef.current = noteId;

        const { micOk, systemOk } = await detectInputs();

        if (micOk && systemOk) {
          console.log("Starting dual recording (mic + system audio)");
          const result = await audioApi.startDualRecordingWithSegments(noteId);
          patch({
            audioPath: result.playbackPath || result.systemPath || result.micPath,
            recordingMode: "dual",
          });
        } else if (micOk) {
          // Through the segment command, like every other mode. The legacy
          // unsegmented path recorded {note_id}.wav with no segment row while
          // pause/resume used segments, so everything before the first pause
          // dropped out of the note's audio and its transcript.
          console.log("Starting mic-only recording");
          const result = await audioApi.startDualRecordingWithSegments(noteId, false);
          patch({ audioPath: result.micPath, recordingMode: "mic-only" });
        } else if (systemOk) {
          console.log("Starting listen-only recording (system audio only)");
          const result = await audioApi.startSystemOnlyRecordingWithSegments(
            noteId
          );
          patch({ audioPath: result.systemPath, recordingMode: "system-only" });
        } else {
          throw new Error(
            "No audio input available. Grant microphone or system audio permission to record."
          );
        }
        patch({ isRecording: true });
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
        // Callers undo what they set up for this recording (the note they
        // created, the recording note id), so they need to know it failed.
        throw e;
      }
    },
    [patch]
  );

  const stopRecording = useCallback(
    async (noteId?: string): Promise<string | null> => {
      try {
        patch({ error: null });
        const id = noteId || currentNoteIdRef.current;

        let path: string | null = null;

        if ((recordingMode === "dual" || recordingMode === "mic-only") && id) {
          console.log("Stopping recording with segments");
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

        patch({
          audioPath: path,
          isRecording: false,
          isPaused: false,
          recordingPhase: RecordingPhase.Idle,
          recordingMode: "idle",
          audioLevel: 0,
        });
        currentNoteIdRef.current = null;
        return path;
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [recordingMode, patch]
  );

  const pauseRecording = useCallback(async () => {
    try {
      patch({ error: null });
      if (recordingMode === "system-only") {
        console.log("Pausing listen-only recording");
        await audioApi.pauseSystemOnlyRecording();
      } else {
        console.log("Pausing dual recording");
        await audioApi.pauseDualRecording();
      }
      patch({
        isRecording: false,
        isPaused: true,
        recordingPhase: RecordingPhase.Paused,
        audioLevel: 0,
      });
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [recordingMode, patch]);

  const resumeRecording = useCallback(
    async (noteId: string) => {
      try {
        patch({ error: null });
        if (recordingMode === "system-only") {
          console.log("Resuming listen-only recording");
          const result = await audioApi.resumeSystemOnlyRecording(noteId);
          patch({ audioPath: result.systemPath });
        } else {
          console.log("Resuming dual recording");
          const result = await audioApi.resumeDualRecording(
            noteId,
            recordingMode !== "mic-only"
          );
          patch({
            audioPath:
              result.playbackPath || result.systemPath || result.micPath,
            recordingMode: result.systemPath !== null ? "dual" : "mic-only",
          });
        }
        patch({
          isRecording: true,
          isPaused: false,
          recordingPhase: RecordingPhase.Recording,
        });
        currentNoteIdRef.current = noteId;
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    [recordingMode, patch]
  );

  const continueRecording = useCallback(
    async (noteId: string) => {
      try {
        patch({ error: null });
        const { micOk, systemOk } = await detectInputs();

        if (!micOk && systemOk) {
          console.log("Continuing in listen-only mode (mic unavailable)");
          const result = await audioApi.startSystemOnlyRecordingWithSegments(
            noteId
          );
          patch({ audioPath: result.systemPath, recordingMode: "system-only" });
        } else if (micOk) {
          console.log("Continuing recording on ended note");
          const result = await audioApi.continueNoteRecording(noteId, systemOk);
          patch({
            audioPath:
              result.playbackPath || result.systemPath || result.micPath,
            recordingMode: result.systemPath !== null ? "dual" : "mic-only",
          });
        } else {
          throw new Error(
            "No audio input available. Grant microphone or system audio permission to record."
          );
        }
        patch({
          isRecording: true,
          isPaused: false,
          recordingPhase: RecordingPhase.Recording,
        });
        currentNoteIdRef.current = noteId;
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
    [patch]
  );

  useEffect(() => {
    if (isRecording) {
      levelIntervalRef.current = window.setInterval(async () => {
        try {
          const level = await audioApi.getAudioLevel();
          useRecordingStore.getState().patch({ audioLevel: level });
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
    audioApi
      .getRecordingStatus()
      .then((status) =>
        useRecordingStore.getState().patch({ isRecording: status })
      )
      .catch(console.error);
  }, []);

  return {
    isRecording,
    isPaused,
    recordingPhase,
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
