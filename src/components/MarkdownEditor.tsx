import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "../styles/milkdown-theme.css";
import { uploadImage } from "../utils/imageUploader";
import { TagAutocomplete } from "./TagAutocomplete";
import { useTagsStore } from "../stores/tagsStore";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  noteId: string;
}

interface AutocompleteState {
  isOpen: boolean;
  query: string;
  position: { top: number; left: number };
  selectedIndex: number;
  startOffset: number;
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder = "",
  noteId,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const isInternalChange = useRef(false);
  const lastExternalValue = useRef(value);

  // Use refs for callbacks to avoid recreating editor
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const noteIdRef = useRef(noteId);

  // Tag autocomplete state
  const { tags } = useTagsStore();
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>({
    isOpen: false,
    query: "",
    position: { top: 0, left: 0 },
    selectedIndex: 0,
    startOffset: 0,
  });

  // Keep callback refs updated
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  // Save on unmount (when switching tabs/notes)
  useEffect(() => {
    return () => {
      onBlurRef.current?.();
    };
  }, []);

  // Stable feature configuration
  const features = useMemo(
    () => ({
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.BlockEdit]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Toolbar]: false,
      [Crepe.Feature.ImageBlock]: true,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.Latex]: true,
    }),
    []
  );

  const featureConfigs = useMemo(
    () => ({
      [Crepe.Feature.Placeholder]: {
        text: placeholder,
      },
      [Crepe.Feature.ImageBlock]: {
        onUpload: async (file: File) => {
          const url = await uploadImage(noteIdRef.current, file);
          return url;
        },
      },
    }),
    [placeholder]
  );

  // Get word at cursor position (looking for #tag pattern)
  const getTagAtCursor = useCallback((_element: Element): { word: string; startOffset: number; rect: DOMRect } | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;

    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) return null;

    const text = container.textContent || "";
    const cursorPos = range.startOffset;

    // Find the start of the current word (looking backward for #)
    let wordStart = cursorPos;
    while (wordStart > 0) {
      const char = text[wordStart - 1];
      if (char === "#") {
        wordStart--;
        break;
      }
      if (!/[a-zA-Z0-9_-]/.test(char)) {
        return null; // Not a tag pattern
      }
      wordStart--;
    }

    // Check if we found a # at the start
    if (text[wordStart] !== "#") return null;

    // Check that # is at the start of line or preceded by whitespace
    if (wordStart > 0 && !/\s/.test(text[wordStart - 1])) return null;

    const word = text.slice(wordStart + 1, cursorPos); // Exclude the #

    // Get position for the dropdown
    const tempRange = document.createRange();
    tempRange.setStart(container, wordStart);
    tempRange.setEnd(container, wordStart);
    const rect = tempRange.getBoundingClientRect();

    return { word, startOffset: wordStart, rect };
  }, []);

  // Handle tag selection from autocomplete
  const handleTagSelect = useCallback((tagName: string) => {
    const editorElement = containerRef.current?.querySelector(".ProseMirror");
    if (!editorElement) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) return;

    const text = container.textContent || "";
    const cursorPos = range.startOffset;

    // Find the #tag to replace
    let wordStart = cursorPos;
    while (wordStart > 0 && text[wordStart - 1] !== "#") {
      if (!/[a-zA-Z0-9_-]/.test(text[wordStart - 1])) break;
      wordStart--;
    }
    if (wordStart > 0 && text[wordStart - 1] === "#") {
      wordStart--;
    }

    // Replace #partial with #fulltagname followed by a space
    const before = text.slice(0, wordStart);
    const after = text.slice(cursorPos);
    const newText = before + "#" + tagName + " " + after;

    // Update text content
    container.textContent = newText;

    // Move cursor to after the inserted tag + space
    const newCursorPos = wordStart + tagName.length + 2; // +2 for # and space
    const newRange = document.createRange();
    newRange.setStart(container, Math.min(newCursorPos, newText.length));
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    // Close autocomplete
    setAutocomplete(prev => ({ ...prev, isOpen: false }));

    // Trigger markdown update
    setTimeout(() => {
      const markdown = crepeRef.current?.getMarkdown() || "";
      isInternalChange.current = true;
      lastExternalValue.current = markdown;
      onChangeRef.current(markdown);
    }, 0);
  }, []);

  // Handle autocomplete keyboard navigation
  const handleAutocompleteKeyDown = useCallback((e: KeyboardEvent) => {
    if (!autocomplete.isOpen) return false;

    const filteredTags = tags.filter(tag =>
      tag.name.toLowerCase().startsWith(autocomplete.query.toLowerCase())
    );
    const maxIndex = Math.min(filteredTags.length - 1, 5);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        setAutocomplete(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex < maxIndex ? prev.selectedIndex + 1 : 0,
        }));
        return true;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        setAutocomplete(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex > 0 ? prev.selectedIndex - 1 : maxIndex,
        }));
        return true;
      case "Enter":
      case "Tab":
        if (filteredTags[autocomplete.selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          handleTagSelect(filteredTags[autocomplete.selectedIndex].name);
        }
        return true;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setAutocomplete(prev => ({ ...prev, isOpen: false }));
        return true;
      default:
        return false;
    }
  }, [autocomplete.isOpen, autocomplete.query, autocomplete.selectedIndex, tags, handleTagSelect]);

  // Check for tag pattern on input
  const handleInput = useCallback((editorElement: Element) => {
    const result = getTagAtCursor(editorElement);

    if (result) {
      // Show autocomplete
      setAutocomplete({
        isOpen: true,
        query: result.word,
        position: {
          top: result.rect.bottom + window.scrollY + 4,
          left: result.rect.left + window.scrollX,
        },
        selectedIndex: 0,
        startOffset: result.startOffset,
      });
    } else {
      // Close autocomplete
      setAutocomplete(prev => {
        if (prev.isOpen) {
          return { ...prev, isOpen: false };
        }
        return prev;
      });
    }
  }, [getTagAtCursor]);

  // Setup autocomplete event handlers
  const setupAutocompleteHandlers = useCallback((editorElement: Element) => {
    const handleKeyDown = (e: Event) => {
      const keyEvent = e as KeyboardEvent;
      if (handleAutocompleteKeyDown(keyEvent)) {
        // Event was handled by autocomplete
        return;
      }
    };

    const handleInputEvent = () => {
      handleInput(editorElement);
    };

    // Also handle selection change for cursor movement
    const handleSelectionChange = () => {
      if (document.activeElement === editorElement || editorElement.contains(document.activeElement)) {
        handleInput(editorElement);
      }
    };

    editorElement.addEventListener("keydown", handleKeyDown, true);
    editorElement.addEventListener("input", handleInputEvent);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      editorElement.removeEventListener("keydown", handleKeyDown, true);
      editorElement.removeEventListener("input", handleInputEvent);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [handleInput, handleAutocompleteKeyDown]);

  // Create editor on mount only
  useEffect(() => {
    if (!containerRef.current) return;

    lastExternalValue.current = value;
    let cleanupAutocomplete: (() => void) | null = null;

    const crepe = new Crepe({
      root: containerRef.current,
      defaultValue: value,
      features,
      featureConfigs,
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        isInternalChange.current = true;
        lastExternalValue.current = markdown;
        onChangeRef.current(markdown);
      });
    });

    crepe.create().then(() => {
      crepeRef.current = crepe;

      // Add blur handler to the editor
      const editorElement = containerRef.current?.querySelector(".ProseMirror");
      if (editorElement) {
        editorElement.addEventListener("blur", () => onBlurRef.current?.());

        // Setup autocomplete handlers
        cleanupAutocomplete = setupAutocompleteHandlers(editorElement);

        // Add paste handler for images (capture phase to run before other handlers)
        editorElement.addEventListener("paste", async (e: Event) => {
          const event = e as ClipboardEvent;
          const items = event.clipboardData?.items;
          if (!items) return;

          for (const item of items) {
            if (item.type.startsWith("image/")) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              const file = item.getAsFile();
              if (file) {
                try {
                  const url = await uploadImage(noteIdRef.current, file);
                  // Get current markdown and append image at the end
                  const currentMarkdown = crepeRef.current?.getMarkdown() || "";
                  const newMarkdown = currentMarkdown + `\n\n![image](${url})\n`;
                  // Update lastExternalValue so the effect will recreate the editor
                  lastExternalValue.current = currentMarkdown;
                  // Trigger onChange which will cause re-render and editor recreation
                  onChangeRef.current(newMarkdown);
                } catch (err) {
                  console.error("Failed to upload pasted image:", err);
                }
              }
              break;
            }
          }
        }, true); // Use capture phase
      }
    });

    return () => {
      cleanupAutocomplete?.();
      crepe.destroy();
      crepeRef.current = null;
    };
    // Only run on mount - use refs for callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle external value changes (e.g., switching notes)
  useEffect(() => {
    // Skip if this is an internal change from typing
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }

    // Only recreate if value actually changed from external source
    if (
      crepeRef.current &&
      value !== lastExternalValue.current &&
      containerRef.current
    ) {
      lastExternalValue.current = value;

      // Close autocomplete when switching notes
      setAutocomplete(prev => ({ ...prev, isOpen: false }));

      // Destroy old editor
      const oldCrepe = crepeRef.current;
      crepeRef.current = null;
      let cleanupAutocomplete: (() => void) | null = null;

      oldCrepe.destroy().then(() => {
        if (!containerRef.current) return;

        // Create new editor with updated value
        const newCrepe = new Crepe({
          root: containerRef.current,
          defaultValue: value,
          features,
          featureConfigs,
        });

        newCrepe.on((listener) => {
          listener.markdownUpdated((_, markdown) => {
            isInternalChange.current = true;
            lastExternalValue.current = markdown;
            onChangeRef.current(markdown);
          });
        });

        newCrepe.create().then(() => {
          crepeRef.current = newCrepe;

          const editorElement =
            containerRef.current?.querySelector(".ProseMirror");
          if (editorElement) {
            editorElement.addEventListener("blur", () => onBlurRef.current?.());

            // Setup autocomplete handlers
            cleanupAutocomplete = setupAutocompleteHandlers(editorElement);

            // Add paste handler for images (capture phase to run before other handlers)
            editorElement.addEventListener("paste", async (e: Event) => {
              const event = e as ClipboardEvent;
              const items = event.clipboardData?.items;
              if (!items) return;

              for (const item of items) {
                if (item.type.startsWith("image/")) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  const file = item.getAsFile();
                  if (file) {
                    try {
                      const url = await uploadImage(noteIdRef.current, file);
                      const currentMarkdown = crepeRef.current?.getMarkdown() || "";
                      const newMarkdown = currentMarkdown + `\n\n![image](${url})\n`;
                      lastExternalValue.current = currentMarkdown;
                      onChangeRef.current(newMarkdown);
                    } catch (err) {
                      console.error("Failed to upload pasted image:", err);
                    }
                  }
                  break;
                }
              }
            }, true); // Use capture phase
          }
        });
      });

      // Return cleanup for this effect (though it won't be called in most cases)
      return () => {
        cleanupAutocomplete?.();
      };
    }
  }, [value, features, featureConfigs, setupAutocompleteHandlers]);

  // Close autocomplete on click outside editor
  useEffect(() => {
    if (!autocomplete.isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideEditor = containerRef.current?.contains(target);
      const isInsideAutocomplete = (target as Element).closest?.(".tag-autocomplete");

      if (!isInsideEditor && !isInsideAutocomplete) {
        setAutocomplete(prev => ({ ...prev, isOpen: false }));
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [autocomplete.isOpen]);

  return (
    <>
      <div
        ref={containerRef}
        className="crepe flex-1 w-full text-base leading-relaxed"
        style={{ color: "var(--color-text)" }}
      />
      {autocomplete.isOpen && (
        <TagAutocomplete
          tags={tags}
          query={autocomplete.query}
          position={autocomplete.position}
          selectedIndex={autocomplete.selectedIndex}
          onSelect={handleTagSelect}
          onClose={() => setAutocomplete(prev => ({ ...prev, isOpen: false }))}
          onNavigate={(direction) => {
            const filteredTags = tags.filter(tag =>
              tag.name.toLowerCase().startsWith(autocomplete.query.toLowerCase())
            );
            const maxIndex = Math.min(filteredTags.length - 1, 5);
            setAutocomplete(prev => ({
              ...prev,
              selectedIndex: direction === "down"
                ? (prev.selectedIndex < maxIndex ? prev.selectedIndex + 1 : 0)
                : (prev.selectedIndex > 0 ? prev.selectedIndex - 1 : maxIndex),
            }));
          }}
        />
      )}
    </>
  );
}
