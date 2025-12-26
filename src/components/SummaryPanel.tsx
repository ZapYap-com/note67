import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { Summary, SummaryType } from "../types";

interface SummaryPanelProps {
  summaries: Summary[];
  isGenerating: boolean;
  streamingContent: string;
  hasTranscript: boolean;
  hasOllamaModel: boolean;
  ollamaRunning: boolean;
  onGenerate: (type: SummaryType, customPrompt?: string) => void;
  onDelete: (summaryId: number) => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

const SUMMARY_TYPES: { value: SummaryType; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "action_items", label: "Action Items" },
  { value: "key_decisions", label: "Key Decisions" },
];

export function SummaryPanel({
  summaries,
  isGenerating,
  streamingContent,
  hasTranscript,
  hasOllamaModel,
  ollamaRunning,
  onGenerate,
  onDelete,
  onRegenerate,
  isRegenerating,
}: SummaryPanelProps) {
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());

  const toggleSummary = (id: number) => {
    setExpandedSummaries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Always expand only the latest summary (first in the list), close others
  useEffect(() => {
    if (summaries.length > 0) {
      setExpandedSummaries(new Set([summaries[0].id]));
    }
  }, [summaries]);

  const canGenerate = hasTranscript && hasOllamaModel && ollamaRunning && !isGenerating;

  const getStatusMessage = () => {
    if (!ollamaRunning) return "Ollama is not running. Start it first.";
    if (!hasOllamaModel) return "No AI model selected.";
    if (!hasTranscript) return "No transcript available.";
    return null;
  };

  const statusMessage = getStatusMessage();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const getSummaryTypeLabel = (type: SummaryType) => {
    const found = SUMMARY_TYPES.find((t) => t.value === type);
    return found?.label ?? type;
  };

  return (
    <div className="space-y-5">
      {/* Status Message */}
      {statusMessage && (
        <div
          className="px-4 py-3 rounded-xl"
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            color: "#b45309",
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Generate Buttons */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {SUMMARY_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => onGenerate(type.value)}
              disabled={!canGenerate}
              className="px-4 py-2.5 font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: canGenerate ? "var(--color-text)" : "var(--color-bg-subtle)",
                color: canGenerate ? "white" : "var(--color-text-tertiary)",
              }}
            >
              {type.label}
            </button>
          ))}
          {/* Regenerate Summary & Title Button */}
          {onRegenerate && summaries.length > 0 && (
            <button
              onClick={onRegenerate}
              disabled={!canGenerate || isRegenerating}
              className="px-4 py-2.5 font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {isRegenerating ? "Regenerating..." : "Regenerate"}
            </button>
          )}
        </div>

        {/* Custom Prompt */}
        <div>
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {showCustom ? "Hide custom prompt" : "+ Custom prompt"}
          </button>
          {showCustom && (
            <div className="mt-3 flex gap-3">
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Ask anything about the meeting..."
                className="flex-1 px-4 py-3 rounded-xl outline-none"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                }}
              />
              <button
                onClick={() => {
                  if (customPrompt.trim()) {
                    onGenerate("custom", customPrompt);
                    setCustomPrompt("");
                  }
                }}
                disabled={!canGenerate || !customPrompt.trim()}
                className="px-5 py-3 font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "var(--color-text)",
                  color: "white",
                }}
              >
                Ask
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Generating Indicator with Streaming Content */}
      {isGenerating && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-elevated)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: streamingContent ? "1px solid var(--color-border-subtle)" : "none" }}
          >
            <div
              className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin shrink-0"
              style={{
                borderColor: "var(--color-text-tertiary)",
                borderTopColor: "transparent",
              }}
            />
            <span style={{ color: "var(--color-text-secondary)" }}>
              Generating summary...
            </span>
          </div>
          {streamingContent && (
            <div
              className="px-4 py-4 prose prose-sm max-w-none"
              style={{ color: "var(--color-text-ai)" }}
            >
              <ReactMarkdown
                components={{
                  h1: ({ children }) => <h1 className="text-lg font-semibold mb-2 mt-3" style={{ color: "var(--color-text)" }}>{children}</h1>,
                  h2: ({ children }) => <h2 className="text-base font-semibold mb-2 mt-3" style={{ color: "var(--color-text)" }}>{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1.5 mt-2" style={{ color: "var(--color-text)" }}>{children}</h3>,
                  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{children}</strong>,
                  code: ({ children }) => <code className="px-1 py-0.5 rounded text-sm" style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</code>,
                }}
              >
                {streamingContent}
              </ReactMarkdown>
              <span className="inline-block w-2 h-4 ml-0.5 animate-pulse" style={{ backgroundColor: "var(--color-text-tertiary)" }} />
            </div>
          )}
        </div>
      )}

      {/* Summaries List */}
      {summaries.length > 0 && (
        <div className="space-y-2">
          {summaries.map((summary) => {
            const isExpanded = expandedSummaries.has(summary.id);
            return (
              <div
                key={summary.id}
                className="rounded-xl overflow-hidden"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
                  style={{ borderBottom: isExpanded ? "1px solid var(--color-border-subtle)" : "none" }}
                  onClick={() => toggleSummary(summary.id)}
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className="w-4 h-4 transition-transform"
                      style={{
                        color: "var(--color-text-tertiary)",
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span
                      className="text-sm font-medium px-2.5 py-1 rounded-lg"
                      style={{
                        backgroundColor: "var(--color-bg-subtle)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {getSummaryTypeLabel(summary.summary_type)}
                    </span>
                    <span className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
                      {formatDate(summary.created_at)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(summary.id);
                    }}
                    className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
                    style={{ color: "var(--color-text-tertiary)" }}
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* AI-generated content with markdown rendering - collapsible */}
                {isExpanded && (
                  <div
                    className="px-4 py-4 prose prose-sm max-w-none"
                    style={{ color: "var(--color-text-ai)" }}
                  >
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <h1 className="text-lg font-semibold mb-2 mt-3" style={{ color: "var(--color-text)" }}>{children}</h1>,
                        h2: ({ children }) => <h2 className="text-base font-semibold mb-2 mt-3" style={{ color: "var(--color-text)" }}>{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1.5 mt-2" style={{ color: "var(--color-text)" }}>{children}</h3>,
                        p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{children}</strong>,
                        code: ({ children }) => <code className="px-1 py-0.5 rounded text-sm" style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</code>,
                      }}
                    >
                      {summary.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {summaries.length === 0 && !isGenerating && canGenerate && (
        <p className="text-center py-6" style={{ color: "var(--color-text-tertiary)" }}>
          Generate a summary using the buttons above.
        </p>
      )}
    </div>
  );
}
