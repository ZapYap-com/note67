interface TaskCheckboxProps {
  done: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
  className?: string;
}

/** The orange task checkbox, shared across the task surfaces. A real
 * checkbox to assistive tech and the keyboard (Space or Enter toggles). */
export function TaskCheckbox({ done, onToggle, size = "sm", className = "" }: TaskCheckboxProps) {
  const dim = size === "md" ? "w-5 h-5" : "w-4 h-4";
  return (
    <span
      role="checkbox"
      aria-checked={done}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      className={`${dim} rounded-[5px] shrink-0 flex items-center justify-center cursor-pointer ${className}`}
      style={{
        backgroundColor: done ? "var(--color-accent)" : "var(--color-bg-elevated)",
        border: done ? "none" : "1.5px solid var(--color-accent)",
      }}
    >
      {done && <span className="text-white text-[10px] leading-none">✓</span>}
    </span>
  );
}
