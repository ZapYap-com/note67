import { invoke } from "@tauri-apps/api/core";
import type { GraphData } from "../types";

export const graphApi = {
  /** Get graph data for visualization */
  getGraphData: (includeOrphans: boolean = true): Promise<GraphData> => {
    return invoke("get_graph_data", { includeOrphans });
  },

};
