import { create } from "zustand";
import { persist } from "zustand/middleware";

interface GraphSettings {
  // Display
  showArrows: boolean;
  textFadeThreshold: number; // 0-1, zoom level where labels start showing
  nodeSize: "fixed" | "connections";

  // Colors
  colorBy: "default" | "tag";

  // Forces (0-100 range for sliders)
  centerForce: number;
  repelForce: number;
  linkDistance: number;

  // Pinned nodes
  pinnedNodes: string[];
}

interface GraphSettingsState extends GraphSettings {
  setShowArrows: (show: boolean) => void;
  setTextFadeThreshold: (value: number) => void;
  setNodeSize: (size: "fixed" | "connections") => void;
  setColorBy: (mode: "default" | "tag") => void;
  setCenterForce: (value: number) => void;
  setRepelForce: (value: number) => void;
  setLinkDistance: (value: number) => void;
  pinNode: (nodeId: string) => void;
  unpinNode: (nodeId: string) => void;
  isPinned: (nodeId: string) => boolean;
  resetForces: () => void;
}

const DEFAULT_SETTINGS: GraphSettings = {
  showArrows: true,
  textFadeThreshold: 0.5,
  nodeSize: "connections",
  colorBy: "default",
  centerForce: 50,
  repelForce: 50,
  linkDistance: 50,
  pinnedNodes: [],
};

export const useGraphSettingsStore = create<GraphSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setShowArrows: (show) => set({ showArrows: show }),
      setTextFadeThreshold: (value) => set({ textFadeThreshold: value }),
      setNodeSize: (size) => set({ nodeSize: size }),
      setColorBy: (mode) => set({ colorBy: mode }),
      setCenterForce: (value) => set({ centerForce: value }),
      setRepelForce: (value) => set({ repelForce: value }),
      setLinkDistance: (value) => set({ linkDistance: value }),

      pinNode: (nodeId) => {
        const { pinnedNodes } = get();
        if (!pinnedNodes.includes(nodeId)) {
          set({ pinnedNodes: [...pinnedNodes, nodeId] });
        }
      },

      unpinNode: (nodeId) => {
        const { pinnedNodes } = get();
        set({ pinnedNodes: pinnedNodes.filter((id) => id !== nodeId) });
      },

      isPinned: (nodeId) => get().pinnedNodes.includes(nodeId),

      resetForces: () =>
        set({
          centerForce: DEFAULT_SETTINGS.centerForce,
          repelForce: DEFAULT_SETTINGS.repelForce,
          linkDistance: DEFAULT_SETTINGS.linkDistance,
        }),
    }),
    {
      name: "graph-settings",
    }
  )
);
