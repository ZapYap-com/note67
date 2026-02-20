import { useEffect, useRef, useMemo } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "../styles/milkdown-theme.css";
import { uploadImage } from "../utils/imageUploader";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  noteId: string;
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

  // Create editor on mount only
  useEffect(() => {
    if (!containerRef.current) return;

    lastExternalValue.current = value;

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

      // Destroy old editor
      const oldCrepe = crepeRef.current;
      crepeRef.current = null;

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
    }
  }, [value, features, featureConfigs]);

  return (
    <div
      ref={containerRef}
      className="crepe flex-1 w-full text-base leading-relaxed"
      style={{ color: "var(--color-text)" }}
    />
  );
}
