import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingNoteSave,
  resetNoteUiStore,
  useNoteUiStore,
} from "./noteUiStore";

describe("flushPendingNoteSave", () => {
  afterEach(() => {
    resetNoteUiStore();
    vi.restoreAllMocks();
  });

  it("never stops what called it, even when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useNoteUiStore
      .getState()
      .setFlushNoteSave(() => Promise.reject(new Error("disk full")));
    await expect(flushPendingNoteSave()).resolves.toBeUndefined();
  });

  it("is a no-op with no note open", async () => {
    await expect(flushPendingNoteSave()).resolves.toBeUndefined();
  });
});
