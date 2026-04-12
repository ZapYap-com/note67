import { useEffect } from "react";
import { useTagsStore } from "../stores/tagsStore";

interface TagsFilterProps {
  onTagSelect?: (tagName: string | null) => void;
}

export function TagsFilter({ onTagSelect }: TagsFilterProps) {
  const { tags, selectedTag, loading, fetchTags, selectTag, clearSelection } =
    useTagsStore();

  // Fetch tags on mount
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleTagClick = (tagName: string) => {
    if (selectedTag === tagName) {
      clearSelection();
      onTagSelect?.(null);
    } else {
      selectTag(tagName);
      onTagSelect?.(tagName);
    }
  };

  const handleClearClick = () => {
    clearSelection();
    onTagSelect?.(null);
  };

  // Don't render if no tags
  if (!loading && tags.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {loading ? (
          <div
            className="text-xs"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Loading tags...
          </div>
        ) : (
          <>
            {/* Clear filter pill (only show when a tag is selected) */}
            {selectedTag && (
              <button
                onClick={handleClearClick}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors"
                style={{
                  backgroundColor: "var(--color-bg-subtle)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                Clear
              </button>
            )}

            {/* Tag pills */}
            {tags.map((tag) => {
              const isSelected = selectedTag === tag.name;
              return (
                <button
                  key={tag.id}
                  onClick={() => handleTagClick(tag.name)}
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: isSelected
                      ? "var(--color-accent)"
                      : "var(--color-bg-subtle)",
                    color: isSelected ? "white" : "var(--color-text-secondary)",
                  }}
                >
                  <span>#</span>
                  <span>{tag.name}</span>
                  <span
                    className="px-1 py-0.5 rounded-full text-[10px]"
                    style={{
                      backgroundColor: isSelected
                        ? "rgba(255,255,255,0.2)"
                        : "var(--color-bg-elevated)",
                      color: isSelected ? "white" : "var(--color-text-tertiary)",
                    }}
                  >
                    {tag.note_count}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
