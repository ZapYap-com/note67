import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Clean up malformed markdown from AI output
function cleanMarkdown(text: string): string {
  let cleaned = text;
  // Remove orphan asterisks at start of lines (****text -> text)
  cleaned = cleaned.replace(/^\*{3,}/gm, '');
  // Fix "** text" (space after **) to "**text" or just remove
  cleaned = cleaned.replace(/\*\*\s+(\S)/g, '**$1');
  // Remove trailing orphan asterisks
  cleaned = cleaned.replace(/\*{2,}$/gm, '');
  // Fix double colons
  cleaned = cleaned.replace(/::/g, ':');
  // Remove duplicate words (simple heuristic)
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');
  return cleaned;
}

interface AISidebarProps {
  isOpen: boolean;
  onClose: () => void;
  noteContent: string;
  selectedText?: string;
  onInsert: (text: string) => void;
  onReplace: (text: string) => void;
  isGenerating: boolean;
  streamingContent: string;
  onGenerate: (prompt: string, action: string) => void;
  onStopGeneration?: () => void;
  onInserted?: () => void; // Called after insert/replace to switch tabs
}

const QUICK_ACTIONS = [
  { id: "improve", label: "Improve", icon: "✨" },
  { id: "summarize", label: "Summarize", icon: "📝" },
  { id: "expand", label: "Expand", icon: "📖" },
  { id: "fix", label: "Fix Grammar", icon: "🔤" },
  { id: "bullets", label: "Bullets", icon: "•" },
  { id: "action_items", label: "Actions", icon: "✓" },
];

export function AISidebar({
  isOpen,
  onClose,
  noteContent,
  selectedText,
  onInsert,
  onReplace,
  isGenerating,
  streamingContent,
  onGenerate,
  onStopGeneration,
  onInserted,
}: AISidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [lastAIResponse, setLastAIResponse] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasGeneratingRef = useRef(false);
  const lastProcessedRef = useRef("");

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Handle streaming completion - update history when generation finishes
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    const justFinished = wasGenerating && !isGenerating && streamingContent;

    if (justFinished && streamingContent !== lastProcessedRef.current) {
      const contentToSave = streamingContent;
      lastProcessedRef.current = contentToSave;
      // Use setTimeout to schedule state update asynchronously
      const timeoutId = setTimeout(() => {
        setLastAIResponse(contentToSave);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: contentToSave,
            timestamp: new Date(),
          },
        ]);
      }, 0);
      return () => clearTimeout(timeoutId);
    }

    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, streamingContent]);

  const handleQuickAction = useCallback(
    (actionId: string) => {
      const content = selectedText || noteContent;
      if (!content.trim()) return;

      // Add user message showing the action
      const actionLabel = QUICK_ACTIONS.find((a) => a.id === actionId)?.label || actionId;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "user",
          content: `${actionLabel}${selectedText ? ` (selected text)` : ""}`,
          timestamp: new Date(),
        },
      ]);

      onGenerate(content, actionId);
    },
    [selectedText, noteContent, onGenerate]
  );

  const handleSendMessage = useCallback(() => {
    const message = inputValue.trim();
    if (!message) return;

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: message,
        timestamp: new Date(),
      },
    ]);

    setInputValue("");
    onGenerate(message, "custom");
  }, [inputValue, onGenerate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInsert = useCallback(() => {
    if (lastAIResponse) {
      onInsert(lastAIResponse);
      setLastAIResponse(null);
      onInserted?.();
    }
  }, [lastAIResponse, onInsert, onInserted]);

  const handleReplace = useCallback(() => {
    if (lastAIResponse) {
      onReplace(lastAIResponse);
      setLastAIResponse(null);
      onInserted?.();
    }
  }, [lastAIResponse, onReplace, onInserted]);

  const handleCopy = useCallback(async () => {
    if (lastAIResponse) {
      await navigator.clipboard.writeText(lastAIResponse);
    }
  }, [lastAIResponse]);

  if (!isOpen) return null;

  return (
    <div
      className="flex flex-col h-full border-l overflow-hidden shrink-0"
      style={{
        width: "320px",
        minWidth: "320px",
        maxWidth: "320px",
        backgroundColor: "var(--color-bg)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            style={{ color: "var(--color-accent)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
            />
          </svg>
          <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            AI Assistant
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-black/5 transition-colors"
          title="Close (Esc)"
        >
          <svg
            className="w-4 h-4"
            style={{ color: "var(--color-text-secondary)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Selected text indicator */}
      {selectedText && (
        <div
          className="px-4 py-2 text-xs border-b"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span className="font-medium">Selection:</span>{" "}
          <span className="italic">
            {selectedText.length > 50 ? `${selectedText.slice(0, 50)}...` : selectedText}
          </span>
        </div>
      )}

      {/* Quick Actions */}
      <div
        className="px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="text-xs font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
          Quick Actions
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => handleQuickAction(action.id)}
              disabled={isGenerating || (!selectedText && !noteContent.trim())}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-bg-elevated)";
              }}
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-3 min-w-0">
        {messages.length === 0 && !isGenerating && (
          <div
            className="text-center py-8 text-sm"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <p className="mb-2">Ask AI to help with your notes</p>
            <p className="text-xs">
              Try: "Summarize this" or "Make it more professional"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} min-w-0`}
          >
            <div
              className="max-w-[85%] px-3 py-2 rounded-lg text-sm overflow-hidden"
              style={{
                backgroundColor:
                  msg.role === "user"
                    ? "var(--color-accent)"
                    : "var(--color-bg-elevated)",
                color: msg.role === "user" ? "white" : "var(--color-text)",
                wordBreak: "break-word",
              }}
            >
              {msg.role === "assistant" ? (
                <div className="max-w-none overflow-hidden" style={{ color: "var(--color-text)" }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      h1: ({ children }) => <h1 className="text-base font-semibold mb-2 mt-2 break-words" style={{ color: "var(--color-text)" }}>{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-semibold mb-1.5 mt-2 break-words" style={{ color: "var(--color-text)" }}>{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-medium mb-1 mt-1.5 break-words" style={{ color: "var(--color-text)" }}>{children}</h3>,
                      p: ({ children }) => <p className="mb-2 leading-relaxed break-words">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5 break-words">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5 break-words">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed break-words">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{children}</strong>,
                      code: ({ children }) => <code className="px-1 py-0.5 rounded text-xs break-all" style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</code>,
                    }}
                  >
                    {cleanMarkdown(msg.content)}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="break-words">{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {isGenerating && (
          <div className="flex justify-start min-w-0">
            <div
              className="max-w-[85%] px-3 py-2 rounded-lg text-sm overflow-hidden"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                color: "var(--color-text)",
                wordBreak: "break-word",
              }}
            >
              {streamingContent ? (
                <div className="max-w-none overflow-hidden" style={{ color: "var(--color-text)" }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      h1: ({ children }) => <h1 className="text-base font-semibold mb-2 mt-2 break-words" style={{ color: "var(--color-text)" }}>{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-semibold mb-1.5 mt-2 break-words" style={{ color: "var(--color-text)" }}>{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-medium mb-1 mt-1.5 break-words" style={{ color: "var(--color-text)" }}>{children}</h3>,
                      p: ({ children }) => <p className="mb-2 leading-relaxed break-words">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5 break-words">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5 break-words">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed break-words">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{children}</strong>,
                      code: ({ children }) => <code className="px-1 py-0.5 rounded text-xs break-all" style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</code>,
                    }}
                  >
                    {cleanMarkdown(streamingContent)}
                  </ReactMarkdown>
                  <span
                    className="inline-block w-2 h-4 ml-0.5 animate-pulse"
                    style={{ backgroundColor: "var(--color-text-tertiary)" }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                    style={{
                      borderColor: "var(--color-text-tertiary)",
                      borderTopColor: "transparent",
                    }}
                  />
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Thinking...
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Action Buttons - show when there's a response */}
      {lastAIResponse && !isGenerating && (
        <div
          className="px-4 py-2 border-t shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex gap-2">
            <button
              onClick={handleInsert}
              className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              Insert
            </button>
            <button
              onClick={handleReplace}
              className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
            >
              {selectedText ? "Replace" : "Replace All"}
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
              title="Copy to clipboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div
        className="px-4 py-3 border-t shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="flex items-end gap-2 rounded-lg p-2"
          style={{
            backgroundColor: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI anything..."
            rows={1}
            disabled={isGenerating}
            className="flex-1 resize-none bg-transparent text-sm outline-none"
            style={{
              color: "var(--color-text)",
              maxHeight: "100px",
            }}
          />
          <button
            onClick={isGenerating ? onStopGeneration : handleSendMessage}
            disabled={!isGenerating && !inputValue.trim()}
            className="p-1.5 rounded-md transition-colors disabled:opacity-50"
            style={{
              backgroundColor: isGenerating ? "var(--color-accent)" : "var(--color-bg-subtle)",
              color: isGenerating ? "white" : "var(--color-text-secondary)",
            }}
          >
            {isGenerating ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>
        <div
          className="text-xs mt-1.5 text-center"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Press Enter to send
        </div>
      </div>
    </div>
  );
}
