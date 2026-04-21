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
  fetchLocalGraph: (noteId: string, depth?: number) => Promise<void>;
  setHoveredNode: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setTagFilter: (tag: string | null) => void;
  setShowOrphans: (show: boolean) => void;
  setLocalCenterNote: (noteId: string | null) => void;
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

  fetchLocalGraph: async (noteId: string, depth?: number) => {
    const actualDepth = depth ?? get().localDepth;
    set({ loading: true, error: null, localCenterNoteId: noteId });
    try {
      const data = await graphApi.getLocalGraph(noteId, actualDepth);
      set({
        nodes: data.nodes,
        edges: data.edges,
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch local graph:", error);
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

  setLocalCenterNote: (noteId) => {
    if (noteId) {
      set({ viewMode: "local" });
      get().fetchLocalGraph(noteId);
    } else {
      set({ localCenterNoteId: null, viewMode: "global" });
      get().fetchGraphData();
    }
  },

  setLocalDepth: (depth) => {
    set({ localDepth: depth });
    const { viewMode, localCenterNoteId } = get();
    if (viewMode === "local" && localCenterNoteId) {
      get().fetchLocalGraph(localCenterNoteId, depth);
    }
  },

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
