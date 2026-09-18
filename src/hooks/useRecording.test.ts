import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useRecording } from "./useRecording";
import { audioApi } from "../api";
import { RecordingPhase } from "../types";
import { resetRecordingStore, useRecordingStore } from "../stores/recordingStore";

vi.mock("../api", () => ({
  audioApi: {
    // input detection
    hasMicrophoneAvailable: vi.fn(),
    hasMicrophonePermission: vi.fn(),
    isSystemAudioSupported: vi.fn(),
    hasSystemAudioPermission: vi.fn(),
    // mic-only
    stopRecording: vi.fn(),
    // dual
    startDualRecordingWithSegments: vi.fn(),
    stopDualRecordingWithSegments: vi.fn(),
    pauseDualRecording: vi.fn(),
    resumeDualRecording: vi.fn(),
    // system-only
    startSystemOnlyRecordingWithSegments: vi.fn(),
    stopSystemOnlyRecordingWithSegments: vi.fn(),
    pauseSystemOnlyRecording: vi.fn(),
    resumeSystemOnlyRecording: vi.fn(),
    // misc
    continueNoteRecording: vi.fn(),
    getActiveRecording: vi.fn(),
    getAudioLevel: vi.fn(),
  },
}));

const api = vi.mocked(audioApi, true);

/** Set the micOk / systemOk matrix that detectInputs() resolves. */
function setInputs({ mic, system }: { mic: boolean; system: boolean }) {
  api.hasMicrophoneAvailable.mockResolvedValue(mic);
  api.hasMicrophonePermission.mockResolvedValue(mic);
  api.isSystemAudioSupported.mockResolvedValue(system);
  api.hasSystemAudioPermission.mockResolvedValue(system);
}

const dualResult = {
  micPath: "/mic.wav",
  systemPath: "/sys.wav",
  playbackPath: "/mix.wav",
};

beforeEach(() => {
  vi.clearAllMocks();
  // State now lives in a module-level zustand store, so it must be reset
  // between tests or it leaks from one case into the next.
  resetRecordingStore();
  // The hook checks recording status once on mount.
  api.getActiveRecording.mockResolvedValue(null);
  api.getAudioLevel.mockResolvedValue(0);
  api.stopRecording.mockResolvedValue("/mic.wav");
  api.startDualRecordingWithSegments.mockResolvedValue(dualResult);
  api.stopDualRecordingWithSegments.mockResolvedValue(dualResult);
  api.startSystemOnlyRecordingWithSegments.mockResolvedValue({
    ...dualResult,
    micPath: null,
  });
  api.stopSystemOnlyRecordingWithSegments.mockResolvedValue({
    ...dualResult,
    micPath: null,
  });
  // Both pause APIs resolve with the elapsed segment duration in ms.
  api.pauseDualRecording.mockResolvedValue(0);
  api.pauseSystemOnlyRecording.mockResolvedValue(0);
  api.resumeDualRecording.mockResolvedValue(dualResult);
  api.resumeSystemOnlyRecording.mockResolvedValue({
    ...dualResult,
    micPath: null,
  });
  api.continueNoteRecording.mockResolvedValue(dualResult);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRecording — mode selection from the micOk x systemOk matrix", () => {
  it("picks dual when both mic and system audio are available", async () => {
    setInputs({ mic: true, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });

    expect(api.startDualRecordingWithSegments).toHaveBeenCalledWith("note-1");
    expect(result.current.recordingMode).toBe("dual");
    expect(result.current.isDualRecording).toBe(true);
    expect(result.current.isRecording).toBe(true);
  });

  it("picks mic-only when system audio is unavailable", async () => {
    setInputs({ mic: true, system: false });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });

    // Segmented like every other mode, without trying system audio.
    expect(api.startDualRecordingWithSegments).toHaveBeenCalledWith("note-1", false);
    expect(result.current.recordingMode).toBe("mic-only");
    expect(result.current.isDualRecording).toBe(false);
  });

  it("picks system-only (listen-only) when the mic is unavailable", async () => {
    setInputs({ mic: false, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });

    expect(api.startSystemOnlyRecordingWithSegments).toHaveBeenCalledWith("note-1");
    expect(result.current.recordingMode).toBe("system-only");
  });

  it("errors and stays idle when no input is available", async () => {
    setInputs({ mic: false, system: false });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await expect(result.current.startRecording("note-1")).rejects.toThrow(
        /no audio input available/i
      );
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingMode).toBe("idle");
    expect(result.current.error).toMatch(/no audio input available/i);
  });

  it("treats an available-but-unpermitted mic as unavailable", async () => {
    api.hasMicrophoneAvailable.mockResolvedValue(true);
    api.hasMicrophonePermission.mockResolvedValue(false);
    api.isSystemAudioSupported.mockResolvedValue(true);
    api.hasSystemAudioPermission.mockResolvedValue(true);

    const { result } = renderHook(() => useRecording());
    await act(async () => {
      await result.current.startRecording("note-1");
    });

    expect(result.current.recordingMode).toBe("system-only");
  });

  it("does not check system audio permission when the platform lacks support", async () => {
    setInputs({ mic: true, system: false });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });

    expect(api.hasSystemAudioPermission).not.toHaveBeenCalled();
  });
});

describe("useRecording — stop dispatches on the current mode", () => {
  it("stops dual via the dual API", async () => {
    setInputs({ mic: true, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(api.stopDualRecordingWithSegments).toHaveBeenCalledWith("note-1");
    expect(api.stopRecording).not.toHaveBeenCalled();
  });

  it("stops system-only via the system-only API", async () => {
    setInputs({ mic: false, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(api.stopSystemOnlyRecordingWithSegments).toHaveBeenCalledWith("note-1");
  });

  it("stops mic-only via the segment API", async () => {
    setInputs({ mic: true, system: false });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(api.stopDualRecordingWithSegments).toHaveBeenCalledWith("note-1");
    expect(api.stopRecording).not.toHaveBeenCalled();
  });

  it("resets all recording state on stop", async () => {
    setInputs({ mic: true, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.recordingMode).toBe("idle");
    expect(useRecordingStore.getState().audioLevel).toBe(0);
    expect(result.current.recordingPhase).toBe(RecordingPhase.Idle);
  });
});

describe("useRecording — pause/resume round-trips preserve mode", () => {
  it("pauses and resumes a dual recording", async () => {
    setInputs({ mic: true, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.pauseRecording();
    });

    expect(api.pauseDualRecording).toHaveBeenCalled();
    expect(result.current.isPaused).toBe(true);
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingPhase).toBe(RecordingPhase.Paused);

    await act(async () => {
      await result.current.resumeRecording("note-1");
    });

    expect(api.resumeDualRecording).toHaveBeenCalledWith("note-1", true);
    expect(result.current.isRecording).toBe(true);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.recordingMode).toBe("dual");
  });

  it("pauses and resumes a system-only recording via the system-only API", async () => {
    setInputs({ mic: false, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.pauseRecording();
    });

    expect(api.pauseSystemOnlyRecording).toHaveBeenCalled();
    expect(api.pauseDualRecording).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.resumeRecording("note-1");
    });

    expect(api.resumeSystemOnlyRecording).toHaveBeenCalledWith("note-1");
    expect(result.current.recordingMode).toBe("system-only");
  });

  it("resumes a mic-only recording without trying system audio", async () => {
    setInputs({ mic: true, system: false });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.pauseRecording();
    });
    await act(async () => {
      await result.current.resumeRecording("note-1");
    });

    expect(api.resumeDualRecording).toHaveBeenCalledWith("note-1", false);
  });

  it("downgrades dual to mic-only when resume returns no system path", async () => {
    setInputs({ mic: true, system: true });
    api.resumeDualRecording.mockResolvedValue({
      ...dualResult,
      systemPath: null,
    });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });
    await act(async () => {
      await result.current.pauseRecording();
    });
    await act(async () => {
      await result.current.resumeRecording("note-1");
    });

    expect(result.current.recordingMode).toBe("mic-only");
  });
});

describe("useRecording — continue on an ended note", () => {
  it("continues normally when the mic is available", async () => {
    setInputs({ mic: true, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.continueRecording("note-1");
    });

    expect(api.continueNoteRecording).toHaveBeenCalledWith("note-1", true);
    expect(result.current.isRecording).toBe(true);
    expect(result.current.recordingMode).toBe("dual");
  });

  it("falls back to listen-only when the mic is gone", async () => {
    setInputs({ mic: false, system: true });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.continueRecording("note-1");
    });

    expect(api.startSystemOnlyRecordingWithSegments).toHaveBeenCalledWith("note-1");
    expect(api.continueNoteRecording).not.toHaveBeenCalled();
    expect(result.current.recordingMode).toBe("system-only");
  });

  it("errors when no input is available", async () => {
    setInputs({ mic: false, system: false });
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await expect(result.current.continueRecording("note-1")).rejects.toThrow(
        /no audio input available/i
      );
    });

    expect(result.current.error).toMatch(/no audio input available/i);
    expect(result.current.isRecording).toBe(false);
  });
});

describe("useRecording — audio level polling", () => {
  it("polls while recording and stops after stop", async () => {
    vi.useFakeTimers();
    setInputs({ mic: true, system: true });
    api.getAudioLevel.mockResolvedValue(0.5);

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording("note-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.getAudioLevel).toHaveBeenCalled();

    const callsWhileRecording = api.getAudioLevel.mock.calls.length;

    await act(async () => {
      await result.current.stopRecording();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // No further polls once the interval is cleared.
    expect(api.getAudioLevel.mock.calls.length).toBe(callsWhileRecording);
  });

  it("clears the polling interval on unmount", async () => {
    vi.useFakeTimers();
    setInputs({ mic: true, system: true });

    const { result, unmount } = renderHook(() => useRecording());
    await act(async () => {
      await result.current.startRecording("note-1");
    });

    unmount();
    const callsAtUnmount = api.getAudioLevel.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.getAudioLevel.mock.calls.length).toBe(callsAtUnmount);
  });
});

describe("useRecording — error handling", () => {
  it("surfaces a start failure and stays idle", async () => {
    setInputs({ mic: true, system: true });
    api.startDualRecordingWithSegments.mockRejectedValue(new Error("device busy"));

    const { result } = renderHook(() => useRecording());
    await act(async () => {
      // Rethrown so the caller can undo what it set up for the recording.
      await expect(result.current.startRecording("note-1")).rejects.toThrow("device busy");
    });

    expect(result.current.error).toBe("device busy");
    expect(result.current.isRecording).toBe(false);
  });

  it("returns null and records the error when stop fails", async () => {
    setInputs({ mic: true, system: true });
    api.stopDualRecordingWithSegments.mockRejectedValue(new Error("write failed"));

    const { result } = renderHook(() => useRecording());
    await act(async () => {
      await result.current.startRecording("note-1");
    });

    let returned: string | null = "unset";
    await act(async () => {
      returned = await result.current.stopRecording();
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe("write failed");
  });

  it("picks up a session still running in the backend on mount", async () => {
    api.getActiveRecording.mockResolvedValue({
      noteId: "note-7",
      paused: true,
      mic: true,
      system: false,
    });
    const { result } = renderHook(() => useRecording());

    await waitFor(() => expect(result.current.isPaused).toBe(true));
    expect(result.current.recordingMode).toBe("mic-only");
    expect(useRecordingStore.getState().recordingNoteId).toBe("note-7");

    // And it can be stopped, as the note it belongs to.
    await act(async () => {
      await result.current.stopRecording();
    });
    expect(api.stopDualRecordingWithSegments).toHaveBeenCalledWith("note-7");
  });

  it("a refused start doesn't take over the session's Stop", async () => {
    setInputs({ mic: true, system: true });
    const { result } = renderHook(() => useRecording());
    await act(async () => {
      await result.current.startRecording("note-1");
    });

    api.startDualRecordingWithSegments.mockRejectedValue(
      new Error("A recording is already in progress.")
    );
    await act(async () => {
      await expect(result.current.startRecording("note-2")).rejects.toThrow();
    });
    await act(async () => {
      await result.current.stopRecording();
    });
    expect(api.stopDualRecordingWithSegments).toHaveBeenCalledWith("note-1");
  });
});
