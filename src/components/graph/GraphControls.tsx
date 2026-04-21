import { useGraphStore } from "../../stores/graphStore";
import { useTagsStore } from "../../stores/tagsStore";

export function GraphControls() {
  const {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    tagFilter,
    setTagFilter,
    showOrphans,
    setShowOrphans,
    localDepth,
    setLocalDepth,
  } = useGraphStore();

  const { tags } = useTagsStore();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* View mode toggle */}
      <div className="flex rounded-md overflow-hidden border border-[var(--color-border)]">
        <button
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === "global"
              ? "bg-[var(--color-accent)] text-white"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
          onClick={() => setViewMode("global")}
        >
          Global
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === "local"
              ? "bg-[var(--color-accent)] text-white"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
          onClick={() => setViewMode("local")}
        >
          Local
        </button>
      </div>

      {/* Depth selector (only in local mode) */}
      {viewMode === "local" && (
        <select
          value={localDepth}
          onChange={(e) => setLocalDepth(Number(e.target.value))}
          className="px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)]"
          title="Connection depth"
        >
          <option value={1}>Depth: 1</option>
          <option value={2}>Depth: 2</option>
          <option value={3}>Depth: 3</option>
        </select>
      )}

      {/* Search input */}
      <div className="relative flex-1 min-w-[120px] max-w-[200px]">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-tertiary)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-7 pr-7 py-1.5 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)] placeholder-[var(--color-text-tertiary)]"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tag filter */}
      <select
        value={tagFilter || ""}
        onChange={(e) => setTagFilter(e.target.value || null)}
        className="px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)]"
      >
        <option value="">All tags</option>
        {tags.map((tag) => (
          <option key={tag.name} value={tag.name}>
            #{tag.name}
          </option>
        ))}
      </select>

      {/* Show orphans toggle */}
      <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer">
        <input
          type="checkbox"
          checked={showOrphans}
          onChange={(e) => setShowOrphans(e.target.checked)}
          className="rounded border-[var(--color-border)] text-[var(--color-accent)]"
        />
        <span>Orphans</span>
      </label>
    </div>
  );
}
