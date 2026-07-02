interface TaskCheckboxProps {
  done: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
  className?: string;
}

/** The orange task checkbox, shared across the task surfaces. */
export function TaskCheckbox({ done, onToggle, size = "sm", className = "" }: TaskCheckboxProps) {
  const dim = size === "md" ? "w-5 h-5" : "w-4 h-4";
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
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
