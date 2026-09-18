import { useCallback, useEffect, useRef } from "react";

/**
 * Saves a note body `delayMs` after the last edit, and returns `save` for the
 * paths that must not wait: editor blur, and flushPendingNoteSave before a
 * stop or a summary reads the body back from the database.
 *
 * `value` is the editor's text and `stored` the note's saved description.
 * Latest values live in refs (updated in effects, not during render), so a
 * save always writes the newest text through the newest callback.
 */
export function useNoteBodySave(
  value: string,
  stored: string,
  onSave: (value: string) => void | Promise<void>,
  delayMs = 1500
): () => Promise<void> {
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // The callback is kept out of the timer's deps. App re-renders constantly
  // while recording and hands down a new callback each time; with it in the
  // deps the timer restarted on every render, so notes typed during a meeting
  // were never autosaved.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const savedRef = useRef(stored);
  useEffect(() => {
    savedRef.current = stored;
  }, [stored]);

  const save = useCallback(async () => {
    const next = valueRef.current;
    // Compared trimmed: text that differed from the stored copy only by
    // surrounding whitespace used to count as unsaved forever, so every save
    // scheduled another one.
    if (next.trim() === savedRef.current.trim()) return;
    savedRef.current = next;
    await onSaveRef.current(next);
  }, []);

  useEffect(() => {
    if (value.trim() === stored.trim()) return;
    const timeoutId = setTimeout(() => {
      void save();
    }, delayMs);
    return () => clearTimeout(timeoutId);
  }, [value, stored, save, delayMs]);

  return save;
}
