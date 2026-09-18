import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTranscription } from "./useTranscription";
import { transcriptionApi } from "../api";
import type { TranscriptSegment } from "../types";

vi.mock("@tauri-apps/api/event", async () => {
  const { createEventBus } = await import("../test/eventBus");
  return createEventBus();
});

vi.mock("../api", () => ({
  transcriptionApi: {
    transcribeAudio: vi.fn(),
    transcribeDualAudio: vi.fn(),
    getTranscript: vi.fn(),
    isTranscribing: vi.fn(),
    isLiveTranscribing: vi.fn(),
    startLiveTranscription: vi.fn(),
    stopLiveTranscription: vi.fn(),
  },
}));

const api = vi.mocked(transcriptionApi, true);

function storedSegment(text: string, speaker: string | null): TranscriptSegment {
  return {
    id: 1,
    note_id: "note-1",
    start_time: 0,
    end_time: 1,
    text,
    speaker,
    source_type: "segment",
    source_id: 1,
    created_at: "2026-07-02T09:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTranscript.mockResolvedValue([]);
});

describe("useTranscription — loadTranscript", () => {
  it("loads and returns stored segments", async () => {
    const segments = [storedSegment("stored", "You")];
    api.getTranscript.mockResolvedValue(segments);

    const { result } = renderHook(() => useTranscription());
    let returned: TranscriptSegment[] = [];
    await act(async () => {
      returned = await result.current.loadTranscript("note-1");
    });

    expect(returned).toEqual(segments);
    expect(result.current.transcript).toEqual(segments);
  });

  it("returns an empty array and records the error on failure", async () => {
    api.getTranscript.mockRejectedValue(new Error("no rows"));

    const { result } = renderHook(() => useTranscription());
    let returned: TranscriptSegment[] = [storedSegment("stale", null)];
    await act(async () => {
      returned = await result.current.loadTranscript("note-1");
    });

    expect(returned).toEqual([]);
    expect(result.current.error).toBe("no rows");
  });
});

