import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionItem } from "../../types";

const createActionItem = vi.fn();
vi.mock("../../api", () => ({ tasksApi: { createActionItem: (...a: unknown[]) => createActionItem(...a) } }));

import { useAddTask } from "./useAddTask";

const item = (text: string) => ({ id: 1, text }) as unknown as ActionItem;

describe("useAddTask", () => {
  beforeEach(() => {
    createActionItem.mockReset();
  });

  it("creates the task with no due date", async () => {
    createActionItem.mockResolvedValue(item("Send the deck"));
    const onCreated = vi.fn();
    const { result } = renderHook(() => useAddTask("note-1", onCreated));

    act(() => result.current.setDraft("  Send the deck "));
    await act(() => result.current.add());

    expect(createActionItem).toHaveBeenCalledWith("note-1", "Send the deck");
    expect(onCreated).toHaveBeenCalledOnce();
    expect(result.current.draft).toBe("");
  });

  it("Enter followed by blur adds the task once", async () => {
    let resolve!: (v: ActionItem) => void;
    createActionItem.mockReturnValue(new Promise<ActionItem>((r) => (resolve = r)));
    const { result } = renderHook(() => useAddTask(null, vi.fn()));

    act(() => result.current.setDraft("Ping legal"));
    // Enter: the request is in flight, and blur fires with the old closure.
    const add = result.current.add;
    let first!: Promise<void>;
    act(() => {
      first = add();
    });
    await act(() => add());
    resolve(item("Ping legal"));
    await act(() => first);

    expect(createActionItem).toHaveBeenCalledOnce();
  });

  it("gives the text back when creating fails", async () => {
    createActionItem.mockRejectedValue(new Error("db locked"));
    const { result } = renderHook(() => useAddTask(null, vi.fn()));

    act(() => result.current.setDraft("Book the room"));
    await act(() => result.current.add());

    expect(result.current.draft).toBe("Book the room");
  });

  it("ignores a blank draft", async () => {
    const { result } = renderHook(() => useAddTask(null, vi.fn()));
    act(() => result.current.setDraft("   "));
    await act(() => result.current.add());
    expect(createActionItem).not.toHaveBeenCalled();
  });
});
