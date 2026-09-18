import { create } from "zustand";
import { graphApi } from "../api/graph";
import type { GraphNode, GraphEdge } from "../types";

type ViewMode = "global" | "local";

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hoveredNodeId: string | null;
  loading: boolean;
  error: string | null;

  // Filters
  viewMode: ViewMode;
  searchQuery: string;
  tagFilter: string | null;
  showOrphans: boolean;
  localCenterNoteId: string | null;
  localDepth: number;

  // Actions
  fetchGraphData: () => Promise<void>;
  setHoveredNode: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setTagFilter: (tag: string | null) => void;
  setShowOrphans: (show: boolean) => void;
  setLocalDepth: (depth: number) => void;
  reset: () => void;
}

export const useGraphStore = create<GraphState>()((set, get) => ({
  nodes: [],
  edges: [],
  hoveredNodeId: null,
  loading: false,
  error: null,
  viewMode: "global",
  searchQuery: "",
  tagFilter: null,
  showOrphans: true,
  localCenterNoteId: null,
  localDepth: 1,

  fetchGraphData: async () => {
    set({ loading: true, error: null });
    try {
      const { showOrphans } = get();
      const data = await graphApi.getGraphData(showOrphans);
      set({
        nodes: data.nodes,
        edges: data.edges,
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch graph data:", error);
      set({ error: String(error), loading: false });
    }
  },

  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  setViewMode: (mode) => {
    set({ viewMode: mode });
    if (mode === "global") {
      set({ localCenterNoteId: null });
      get().fetchGraphData();
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setTagFilter: (tag) => set({ tagFilter: tag }),

  setShowOrphans: (show) => {
    set({ showOrphans: show });
    if (get().viewMode === "global") {
      get().fetchGraphData();
    }
  },

  // Local mode was never wired up (nothing set a center note); the depth is
  // kept only for the control. The graph view goes away in 0.2.0.
  setLocalDepth: (depth) => set({ localDepth: depth }),

  reset: () => {
    set({
      nodes: [],
      edges: [],
      hoveredNodeId: null,
      loading: false,
      error: null,
      viewMode: "global",
      searchQuery: "",
      tagFilter: null,
      showOrphans: true,
      localCenterNoteId: null,
      localDepth: 1,
    });
  },
}));
