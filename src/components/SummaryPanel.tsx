import { useState } from "react";
import type { Summary, SummaryType } from "../types";

interface SummaryPanelProps {
  summaries: Summary[];
  isGenerating: boolean;
  hasTranscript: boolean;
  hasOllamaModel: boolean;
  ollamaRunning: boolean;
  onGenerate: (type: SummaryType, customPrompt?: string) => void;
  onDelete: (summaryId: number) => void;
}

const SUMMARY_TYPES: { value: SummaryType; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "action_items", label: "Action Items" },
  { value: "key_decisions", label: "Key Decisions" },
];

export function SummaryPanel({
  summaries,
  isGenerating,
  hasTranscript,
  hasOllamaModel,
  ollamaRunning,
  onGenerate,
  onDelete,
}: SummaryPanelProps) {
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustom, setShowCustom] = useState(false);

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

      {/* Generating Indicator */}
      {isGenerating && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ backgroundColor: "var(--color-bg-elevated)" }}
        >
          <div
            className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
            style={{
              borderColor: "var(--color-text-tertiary)",
              borderTopColor: "transparent",
            }}
          />
          <span style={{ color: "var(--color-text-secondary)" }}>
            Generating...
          </span>
        </div>
      )}

      {/* Summaries List */}
      {summaries.length > 0 && (
        <div className="space-y-4">
          {summaries.map((summary) => (
            <div
              key={summary.id}
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
              >
                <div className="flex items-center gap-3">
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
                  onClick={() => onDelete(summary.id)}
                  className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
                  style={{ color: "var(--color-text-tertiary)" }}
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* AI-generated content in gray per Granola style */}
              <div
                className="px-4 py-4 leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--color-text-ai)" }}
              >
                {summary.content}
              </div>
            </div>
          ))}
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
