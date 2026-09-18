import { useEffect, useState } from "react";

type Menu = { x: number; y: number; id: number };

/**
 * The right-click Delete menu. Click-away closes it; Escape closes the menu,
 * else deselects the task. Escape is caught in the capture phase and stopped,
 * so the app's global Escape (which would close the note) doesn't also fire.
 */
export function useTaskMenu({
  selectedId,
  onDeselect,
  onDelete,
}: {
  selectedId: number | null;
  onDeselect: () => void;
  onDelete: (id: number) => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) {
        setMenu(null);
        e.stopPropagation();
      } else if (selectedId != null) {
        onDeselect();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu, selectedId, onDeselect]);

  const openMenu = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, id });
  };

  const menuElement = menu && (
    <div
      role="menu"
      className="fixed z-[100] min-w-[140px] py-1 rounded-lg"
      style={{
        left: menu.x,
        top: menu.y,
        backgroundColor: "var(--color-bg-elevated)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
      }}
    >
      <button
        role="menuitem"
        onClick={() => {
          onDelete(menu.id);
          setMenu(null);
        }}
        className="w-full px-3 py-1.5 flex items-center gap-2.5 text-sm transition-colors hover:bg-black/5"
        style={{ color: "#ef4444" }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </button>
    </div>
  );

  return { openMenu, menuElement };
}
