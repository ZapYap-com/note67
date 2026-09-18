import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoteBodySave } from "./useNoteBodySave";

type Props = { value: string; stored: string; onSave: (v: string) => void };

function setup(initial: Props) {
  return renderHook((p: Props) => useNoteBodySave(p.value, p.stored, p.onSave), {
    initialProps: initial,
  });
}

describe("useNoteBodySave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves 1.5 s after the last edit", () => {
    const onSave = vi.fn();
    const { rerender } = setup({ value: "a", stored: "a", onSave });
    rerender({ value: "ab", stored: "a", onSave });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ value: "abc", stored: "a", onSave });
    act(() => vi.advanceTimersByTime(1499));
    expect(onSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith("abc");
  });

  it("saves a cleared body as an empty string", () => {
    const onSave = vi.fn();
    const { rerender } = setup({ value: "old notes", stored: "old notes", onSave });
    rerender({ value: "", stored: "old notes", onSave });
    act(() => vi.advanceTimersByTime(1500));
    expect(onSave).toHaveBeenCalledWith("");
  });

  it("is not starved by a parent re-rendering with new callbacks", () => {
    // While recording, App re-rendered every 100 ms with a fresh callback.
    const saved: string[] = [];
    const { rerender } = setup({ value: "x", stored: "", onSave: (v) => saved.push(v) });
    for (let i = 0; i < 30; i++) {
      rerender({ value: "x", stored: "", onSave: (v) => saved.push(v) });
      act(() => vi.advanceTimersByTime(100));
    }
    expect(saved).toEqual(["x"]);
  });

  it("does not save whitespace-only differences, so saves can't loop", () => {
    const onSave = vi.fn();
    const { rerender } = setup({ value: "text", stored: "text", onSave });
    rerender({ value: "text\n", stored: "text", onSave });
    act(() => vi.advanceTimersByTime(5000));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flushes a pending edit on demand, once", async () => {
    const onSave = vi.fn();
    const { result, rerender } = setup({ value: "a", stored: "a", onSave });
    rerender({ value: "a b", stored: "a", onSave });
    await act(() => result.current());
    expect(onSave).toHaveBeenCalledWith("a b");
    // The debounce still fires, but there is nothing new to save.
    act(() => vi.advanceTimersByTime(1500));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does nothing when flushed with no edits", async () => {
    const onSave = vi.fn();
    const { result } = setup({ value: "a", stored: "a", onSave });
    await act(() => result.current());
    expect(onSave).not.toHaveBeenCalled();
  });
});
