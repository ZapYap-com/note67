import { invoke } from "@tauri-apps/api/core";
import type { GraphData } from "../types";

export const graphApi = {
  /** Get graph data for visualization */
  getGraphData: (includeOrphans: boolean = true): Promise<GraphData> => {
    return invoke("get_graph_data", { includeOrphans });
  },

  /** Get local graph centered on a specific note */
  getLocalGraph: (noteId: string, depth: number = 1): Promise<GraphData> => {
    return invoke("get_local_graph", { noteId, depth });
  },
};
