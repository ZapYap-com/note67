import { create } from "zustand";
import { graphApi } from "../api/graph";
import type { GraphNode, GraphEdge } from "../types";

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hoveredNodeId: string | null;
  loading: boolean;
  error: string | null;

  fetchGraphData: () => Promise<void>;
  setHoveredNode: (id: string | null) => void;
  reset: () => void;
}

export const useGraphStore = create<GraphState>()((set) => ({
  nodes: [],
  edges: [],
  hoveredNodeId: null,
  loading: false,
  error: null,

  fetchGraphData: async () => {
    set({ loading: true, error: null });
    try {
      const data = await graphApi.getGraphData();
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

  reset: () => {
    set({
      nodes: [],
      edges: [],
      hoveredNodeId: null,
      loading: false,
      error: null,
    });
  },
}));
