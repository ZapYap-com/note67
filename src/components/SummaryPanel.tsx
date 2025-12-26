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

const SUMMARY_TYPES: { value: SummaryType; label: string; icon: string }[] = [
  { value: "overview", label: "Overview", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { value: "action_items", label: "Action Items", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { value: "key_decisions", label: "Key Decisions", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
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
    if (!ollamaRunning) return "Ollama is not running. Start Ollama first.";
    if (!hasOllamaModel) return "No AI model selected. Select a model in settings.";
    if (!hasTranscript) return "No transcript available. Transcribe the meeting first.";
    return null;
  };

  const statusMessage = getStatusMessage();

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getSummaryTypeLabel = (type: SummaryType) => {
    const found = SUMMARY_TYPES.find((t) => t.value === type);
    return found?.label ?? type;
  };

  return (
    <div className="space-y-4">
      {/* Status Message */}
      {statusMessage && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">{statusMessage}</p>
        </div>
      )}

      {/* Generate Buttons */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {SUMMARY_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => onGenerate(type.value)}
              disabled={!canGenerate}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={type.icon} />
              </svg>
              {type.label}
            </button>
          ))}
        </div>

        {/* Custom Prompt */}
        <div>
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {showCustom ? "Hide custom prompt" : "Use custom prompt"}
          </button>
          {showCustom && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Ask anything about the meeting..."
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={() => {
                  if (customPrompt.trim()) {
                    onGenerate("custom", customPrompt);
                    setCustomPrompt("");
                  }
                }}
                disabled={!canGenerate || !customPrompt.trim()}
                className="px-4 py-2 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ask
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Generating Indicator */}
      {isGenerating && (
        <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-300 border-t-indigo-600" />
          <span className="text-sm text-indigo-700 dark:text-indigo-300">
            Generating summary...
          </span>
        </div>
      )}

      {/* Summaries List */}
      {summaries.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Generated Summaries
          </h4>
          {summaries.map((summary) => (
            <div
              key={summary.id}
              className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="inline-block px-2 py-0.5 text-xs font-medium bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded">
                    {getSummaryTypeLabel(summary.summary_type)}
                  </span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(summary.created_at)}
                  </span>
                </div>
                <button
                  onClick={() => onDelete(summary.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title="Delete summary"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {summary.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {summaries.length === 0 && !isGenerating && canGenerate && (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          No summaries yet. Generate one using the buttons above.
        </p>
      )}
    </div>
  );
}
