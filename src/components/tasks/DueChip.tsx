interface DueChipProps {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  overdue?: boolean;
}

function formatShort(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** A subtle due-date chip with an outlined calendar icon. */
export function DueChip({ date, overdue }: DueChipProps) {
  return (
    <span
      className="text-xs flex items-center gap-1"
      style={{ color: overdue ? "var(--color-accent)" : "var(--color-text-tertiary)" }}
    >
      <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
      {formatShort(date)}
    </span>
  );
}
