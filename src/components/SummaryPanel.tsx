import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Summary, SummaryType } from "../types";

interface SummaryPanelProps {
  summaries: Summary[];
  isGenerating: boolean;
  streamingContent: string;
  onDelete: (summaryId: number) => void;
  onCopy: (content: string) => void;
}

const SUMMARY_TYPE_LABELS: Record<SummaryType, string> = {
  overview: "Overview",
  action_items: "Action Items",
  key_decisions: "Key Decisions",
  custom: "Custom",
};

export function SummaryPanel({
  summaries,
  isGenerating,
  streamingContent,
  onDelete,
  onCopy,
}: SummaryPanelProps) {
  // Track explicit expand/collapse state per summary. undefined = use default (newest expanded, others collapsed)
  const [expandState, setExpandState] = useState<Map<number, boolean>>(new Map());
  // Track which summary was just copied (for showing "Copied" feedback)
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = (summaryId: number, content: string) => {
    onCopy(content);
    setCopiedId(summaryId);
    setTimeout(() => setCopiedId(null), 5000);
  };

  const toggleSummary = (id: number, currentlyExpanded: boolean) => {
    setExpandState((prev) => {
      const next = new Map(prev);
      next.set(id, !currentlyExpanded);
      return next;
    });
  };

  // A summary is expanded if explicitly set, or if newest (index 0) by default
  const isSummaryExpanded = (summaryId: number, index: number) => {
    const explicit = expandState.get(summaryId);
    if (explicit !== undefined) return explicit;
    // Default: newest is expanded, others are collapsed
    return index === 0;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const getSummaryTypeLabel = (type: SummaryType) => {
    return SUMMARY_TYPE_LABELS[type] ?? type;
  };

  return (
    <div className="space-y-5">
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
          {summaries.map((summary, index) => {
            const isExpanded = isSummaryExpanded(summary.id, index);
            // Hide delete button if this is the only overview
            const overviewCount = summaries.filter(s => s.summary_type === "overview").length;
            const hideDelete = summary.summary_type === "overview" && overviewCount === 1;
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
                  onClick={() => toggleSummary(summary.id, isExpanded)}
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
                  <div className="flex items-center gap-1">
                    {copiedId === summary.id && (
                      <span
                        className="text-xs font-medium mr-1"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Copied
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(summary.id, summary.content);
                      }}
                      className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
                      style={{ color: "var(--color-text-tertiary)" }}
                      title="Copy"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    {!hideDelete && (
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
                    )}
                  </div>
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
      {summaries.length === 0 && !isGenerating && (
        <p className="text-center py-6" style={{ color: "var(--color-text-tertiary)" }}>
          No summaries yet.
        </p>
      )}
    </div>
  );
}
