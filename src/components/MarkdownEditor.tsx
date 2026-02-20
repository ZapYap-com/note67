import { useEffect, useRef, useMemo } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "../styles/milkdown-theme.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder = "",
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const isInternalChange = useRef(false);
  const lastExternalValue = useRef(value);

  // Use refs for callbacks to avoid recreating editor
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);

  // Keep callback refs updated
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

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
      [Crepe.Feature.BlockEdit]: {
        blockHandle: {
          shouldShow: () => true,
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
