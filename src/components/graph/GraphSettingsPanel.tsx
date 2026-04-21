import { useGraphSettingsStore } from "../../stores/graphSettingsStore";

interface GraphSettingsPanelProps {
  isOpen: boolean;
}

export function GraphSettingsPanel({ isOpen }: GraphSettingsPanelProps) {
  const settings = useGraphSettingsStore();

  if (!isOpen) return null;

  return (
    <div
      className="absolute top-28 left-4 w-64 rounded-lg shadow-lg p-4 z-20"
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Display Section */}
      <div className="mb-4">
        <h4
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Display
        </h4>

        <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showArrows}
            onChange={(e) => settings.setShowArrows(e.target.checked)}
            className="rounded"
          />
          <span style={{ color: "var(--color-text-secondary)" }}>
            Show link direction
          </span>
        </label>

        <label className="block text-xs mb-2">
          <span
            className="block mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Text fade threshold
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.textFadeThreshold * 100}
            onChange={(e) =>
              settings.setTextFadeThreshold(Number(e.target.value) / 100)
            }
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        </label>

        <label className="block text-xs">
          <span
            className="block mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Node size
          </span>
          <select
            value={settings.nodeSize}
            onChange={(e) =>
              settings.setNodeSize(e.target.value as "fixed" | "connections")
            }
            className="w-full px-2 py-1 text-xs rounded border"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            <option value="connections">By connections</option>
            <option value="fixed">Fixed size</option>
          </select>
        </label>
      </div>

      {/* Colors Section */}
      <div className="mb-4">
        <h4
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Colors
        </h4>

        <label className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
          <input
            type="radio"
            name="colorBy"
            checked={settings.colorBy === "default"}
            onChange={() => settings.setColorBy("default")}
          />
          <span style={{ color: "var(--color-text-secondary)" }}>Default</span>
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="radio"
            name="colorBy"
            checked={settings.colorBy === "tag"}
            onChange={() => settings.setColorBy("tag")}
          />
          <span style={{ color: "var(--color-text-secondary)" }}>
            Color by tag
          </span>
        </label>
      </div>

      {/* Forces Section */}
      <div className="mb-4">
        <h4
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text)" }}
        >
          Forces
        </h4>

        <label className="block text-xs mb-2">
          <span
            className="flex justify-between mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <span>Center force</span>
            <span>{settings.centerForce}</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.centerForce}
            onChange={(e) => settings.setCenterForce(Number(e.target.value))}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        </label>

        <label className="block text-xs mb-2">
          <span
            className="flex justify-between mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <span>Repel force</span>
            <span>{settings.repelForce}</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.repelForce}
            onChange={(e) => settings.setRepelForce(Number(e.target.value))}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        </label>

        <label className="block text-xs mb-3">
          <span
            className="flex justify-between mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <span>Link distance</span>
            <span>{settings.linkDistance}</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.linkDistance}
            onChange={(e) => settings.setLinkDistance(Number(e.target.value))}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        </label>

        <button
          onClick={settings.resetForces}
          className="w-full px-3 py-1.5 text-xs rounded-lg transition-colors hover:opacity-80"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
        >
          Reset forces
        </button>
      </div>

      {/* Help */}
      <div
        className="text-xs pt-2"
        style={{
          color: "var(--color-text-tertiary)",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <p>Shift+click node to pin/unpin</p>
      </div>
    </div>
  );
}
