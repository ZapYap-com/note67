import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useNotes } from "./useNotes";
import { notesApi } from "../api";
import { deleteNoteAttachments } from "../utils/imageUploader";
import type { Note } from "../types";

vi.mock("../api", () => ({
  notesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    search: vi.fn(),
    end: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../utils/imageUploader", () => ({
  deleteNoteAttachments: vi.fn(),
}));

const api = vi.mocked(notesApi, true);
const mockDeleteAttachments = vi.mocked(deleteNoteAttachments);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Weekly Sync",
    description: "",
    participants: null,
    started_at: "2026-07-02T09:00:00.000Z",
    ended_at: null,
    audio_path: null,
    created_at: "2026-07-02T09:00:00.000Z",
    updated_at: "2026-07-02T09:00:00.000Z",
    ...overrides,
  } as Note;
}

const noteA = makeNote({ id: "a", title: "Alpha" });
const noteB = makeNote({ id: "b", title: "Beta" });

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([noteA, noteB]);
  mockDeleteAttachments.mockResolvedValue(undefined);
});

/** Render and wait for the initial load to settle. */
async function renderLoaded() {
  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useNotes — initial load", () => {
  it("populates notes and clears loading", async () => {
    const { result } = await renderLoaded();

    expect(result.current.notes).toEqual([noteA, noteB]);
    expect(result.current.error).toBeNull();
  });

  it("records an error and still clears loading when the load fails", async () => {
    api.list.mockRejectedValue(new Error("db locked"));
    const { result } = await renderLoaded();

    expect(result.current.error).toBe("db locked");
    expect(result.current.notes).toEqual([]);
  });
});

describe("useNotes — mutations mirror into the local list", () => {
  it("createNote prepends the new note", async () => {
    const created = makeNote({ id: "c", title: "Gamma" });
    api.create.mockResolvedValue(created);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.createNote("Gamma");
    });

    expect(result.current.notes.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("createNote returns the created note", async () => {
    const created = makeNote({ id: "c" });
    api.create.mockResolvedValue(created);
    const { result } = await renderLoaded();

    let returned: Note | undefined;
    await act(async () => {
      returned = await result.current.createNote("Gamma", "desc", "someone");
    });

    expect(returned).toEqual(created);
    expect(api.create).toHaveBeenCalledWith({
      title: "Gamma",
      description: "desc",
      participants: "someone",
    });
  });

  it("updateNote replaces only the matching note, preserving order", async () => {
    const updated = makeNote({ id: "a", title: "Alpha renamed" });
    api.update.mockResolvedValue(updated);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.updateNote("a", { title: "Alpha renamed" });
    });

    expect(result.current.notes).toEqual([updated, noteB]);
  });

  it("endNote patches ended_at and audio_path in place", async () => {
    api.end.mockResolvedValue(undefined);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.endNote("a", "/tmp/audio.wav");
    });

    const [first, second] = result.current.notes;
    expect(first.id).toBe("a");
    expect(first.audio_path).toBe("/tmp/audio.wav");
    expect(first.ended_at).toEqual(expect.any(String));
    // Untouched note keeps its identity.
    expect(second).toEqual(noteB);
  });

  it("endNote sets audio_path to null when no path is given", async () => {
    api.end.mockResolvedValue(undefined);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.endNote("a");
    });

    expect(result.current.notes[0].audio_path).toBeNull();
  });

  it("deleteNote removes the note and cleans up its attachments", async () => {
    api.delete.mockResolvedValue(undefined);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.deleteNote("a");
    });

    expect(result.current.notes.map((n) => n.id)).toEqual(["b"]);
    expect(mockDeleteAttachments).toHaveBeenCalledWith("a");
  });

  it("deleteNote still removes the note when attachment cleanup fails", async () => {
    api.delete.mockResolvedValue(undefined);
    mockDeleteAttachments.mockRejectedValue(new Error("no such folder"));
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.deleteNote("a");
    });

    expect(result.current.notes.map((n) => n.id)).toEqual(["b"]);
  });
});
