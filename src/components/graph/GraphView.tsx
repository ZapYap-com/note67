import { useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { useGraphStore } from "../../stores/graphStore";
import { useGraphSettingsStore } from "../../stores/graphSettingsStore";
import { useTagsStore } from "../../stores/tagsStore";
import { GraphNodePreview } from "./GraphNodePreview";
import { GraphControls } from "./GraphControls";
import { useGraphUpdates } from "../../hooks/useGraphUpdates";
import type { GraphNode, GraphEdge } from "../../types";

interface GraphViewProps {
  onSelectNote: (noteId: string) => void;
}

export function GraphView({ onSelectNote }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(
    null
  );
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const {
    nodes,
    edges,
    fetchGraphData,
    setHoveredNode,
    hoveredNodeId,
    loading,
    searchQuery,
    tagFilter,
    viewMode,
    localCenterNoteId,
  } = useGraphStore();

  const settings = useGraphSettingsStore();
  const { getTagColor } = useTagsStore();

  // Enable real-time updates
  useGraphUpdates();

  // Fetch graph data on mount
  useEffect(() => {
    fetchGraphData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter nodes by tag (client-side filtering)
  const filteredData = useMemo(() => {
    let filteredNodes = nodes;
    let filteredEdges = edges;

    if (tagFilter) {
      const nodeIds = new Set(
        filteredNodes.filter((n) => n.tags.includes(tagFilter)).map((n) => n.id)
      );
      filteredNodes = filteredNodes.filter((n) => nodeIds.has(n.id));
      filteredEdges = filteredEdges.filter((e) => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });
    }

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [nodes, edges, tagFilter]);

  // Compute highlighted nodes from search
  const highlightedNodeIds = useMemo(() => {
    if (!searchQuery) return new Set<string>();
    const query = searchQuery.toLowerCase();
    return new Set(
      nodes.filter((n) => n.title.toLowerCase().includes(query)).map((n) => n.id)
    );
  }, [nodes, searchQuery]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .call(zoomRef.current.scaleBy, 1.5);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .call(zoomRef.current.scaleBy, 0.67);
    }
  }, []);

  const handleFitView = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(0, 0).scale(1)
      );
    }
  }, []);

  // Get node radius based on settings
  const getNodeRadius = useCallback(
    (d: GraphNode) => {
      if (settings.nodeSize === "fixed") return 10;
      return Math.max(6, Math.min(20, 6 + d.link_count * 2));
    },
    [settings.nodeSize]
  );

  // Get node color based on settings
  const getNodeColor = useCallback(
    (d: GraphNode) => {
      if (settings.colorBy === "tag" && d.tags.length > 0) {
        return getTagColor(d.tags[0]);
      }
      // Highlight center node in local view
      if (viewMode === "local" && d.id === localCenterNoteId) {
        return "var(--color-accent-emphasis, #1d4ed8)";
      }
      // Dim orphan nodes
      if (d.is_orphan) {
        return "var(--color-text-tertiary)";
      }
      return "var(--color-accent)";
    },
    [settings.colorBy, viewMode, localCenterNoteId, getTagColor]
  );

  const renderGraph = useCallback(() => {
    if (
      !svgRef.current ||
      !containerRef.current ||
      filteredData.nodes.length === 0
    )
      return;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous render
    svg.selectAll("*").remove();

    // Set SVG dimensions
    svg.attr("width", width).attr("height", height);

    // Add arrow marker for directed edges
    if (settings.showArrows) {
      svg
        .append("defs")
        .append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "-0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .append("path")
        .attr("d", "M 0,-5 L 10,0 L 0,5")
        .attr("fill", "var(--color-border)");
    }

    // Create container group for zoom/pan
    const g = svg.append("g");

    // Setup zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        // Fade text based on zoom level and threshold
        const scale = event.transform.k;
        g.selectAll(".node-label").style(
          "opacity",
          scale >= settings.textFadeThreshold ? 1 : 0
        );
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Create a working copy of nodes and edges for D3
    const nodesCopy: GraphNode[] = filteredData.nodes.map((n) => ({ ...n }));
    const edgesCopy: GraphEdge[] = filteredData.edges.map((e) => ({ ...e }));

    // Map settings (0-100) to actual force values
    const centerStrength = settings.centerForce / 100;
    const repelStrength = -100 - settings.repelForce * 5; // -100 to -600
    const linkDist = 50 + settings.linkDistance * 2; // 50 to 250

    // Create force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodesCopy)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edgesCopy)
          .id((d) => d.id)
          .distance(linkDist)
      )
      .force("charge", d3.forceManyBody().strength(repelStrength))
      .force(
        "center",
        d3.forceCenter(width / 2, height / 2).strength(centerStrength)
      )
      .force("collision", d3.forceCollide().radius(50));

    simulationRef.current = simulation;

    // Draw edges
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(edgesCopy)
      .join("line")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1)
      .attr("marker-end", settings.showArrows ? "url(#arrowhead)" : null);

    // Draw nodes
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodesCopy)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended)
      );

    // Node circles
    node
      .append("circle")
      .attr("r", getNodeRadius)
      .attr("fill", getNodeColor)
      .attr("stroke", (d) => {
        // Highlight search matches with yellow border
        if (highlightedNodeIds.has(d.id)) {
          return "#fbbf24";
        }
        return "var(--color-background)";
      })
      .attr("stroke-width", (d) => (highlightedNodeIds.has(d.id) ? 3 : 2))
      .attr("opacity", (d) => (d.is_orphan ? 0.5 : 1));

    // Pin indicator for pinned nodes
    node
      .filter((d) => settings.pinnedNodes.includes(d.id))
      .append("circle")
      .attr("class", "pin-indicator")
      .attr("r", 4)
      .attr("cx", (d) => getNodeRadius(d) - 4)
      .attr("cy", (d) => -getNodeRadius(d) + 4)
      .attr("fill", "#ef4444");

    // Node labels
    node
      .append("text")
      .attr("class", "node-label")
      .text((d) => d.title)
      .attr("x", (d) => getNodeRadius(d) + 6)
      .attr("y", 4)
      .attr("font-size", "12px")
      .attr("fill", "var(--color-text)")
      .attr("font-weight", (d) =>
        highlightedNodeIds.has(d.id) ? "bold" : "normal"
      )
      .attr("cursor", "pointer");

    // Click to navigate (or shift+click to pin)
    node.on("click", (event, d) => {
      if (event.shiftKey) {
        // Toggle pin
        if (settings.isPinned(d.id)) {
          settings.unpinNode(d.id);
          d.fx = null;
          d.fy = null;
        } else {
          settings.pinNode(d.id);
          d.fx = d.x;
          d.fy = d.y;
        }
        // Refresh to show/hide pin indicator
        simulation.alpha(0.1).restart();
      } else {
        onSelectNote(d.id);
      }
    });

    // Hover handlers
    node.on("mouseenter", (_event, d) => {
      setHoveredNode(d.id);
      // Highlight connected edges
      link
        .attr("stroke-opacity", (l) => {
          const source = typeof l.source === "object" ? l.source.id : l.source;
          const target = typeof l.target === "object" ? l.target.id : l.target;
          return source === d.id || target === d.id ? 1 : 0.15;
        })
        .attr("stroke-width", (l) => {
          const source = typeof l.source === "object" ? l.source.id : l.source;
          const target = typeof l.target === "object" ? l.target.id : l.target;
          return source === d.id || target === d.id ? 2 : 1;
        });
      // Fade non-connected nodes
      node.select("circle").attr("opacity", (n) => {
        if (n.id === d.id) return 1;
        const connected = edgesCopy.some((e) => {
          const source = typeof e.source === "object" ? e.source.id : e.source;
          const target = typeof e.target === "object" ? e.target.id : e.target;
          return (
            (source === d.id && target === n.id) ||
            (target === d.id && source === n.id)
          );
        });
        return connected ? 1 : 0.3;
      });
    });

    node.on("mouseleave", () => {
      setHoveredNode(null);
      link.attr("stroke-opacity", 0.5).attr("stroke-width", 1);
      node.select("circle").attr("opacity", (d) => (d.is_orphan ? 0.5 : 1));
    });

    // Update positions on simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Initialize pinned nodes
    nodesCopy.forEach((d) => {
      if (settings.pinnedNodes.includes(d.id)) {
        d.fx = d.x;
        d.fy = d.y;
      }
    });

    // Drag handlers
    function dragstarted(
      event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>,
      d: GraphNode
    ) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(
      event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>,
      d: GraphNode
    ) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(
      event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>,
      d: GraphNode
    ) {
      if (!event.active) simulation.alphaTarget(0);
      // Keep pinned if in pinnedNodes
      if (!settings.pinnedNodes.includes(d.id)) {
        d.fx = null;
        d.fy = null;
      }
    }

    // Center the view initially
    const initialTransform = d3.zoomIdentity.translate(0, 0).scale(1);
    svg.call(zoom.transform, initialTransform);
  }, [
    filteredData,
    highlightedNodeIds,
    viewMode,
    localCenterNoteId,
    onSelectNote,
    setHoveredNode,
    settings,
    getNodeRadius,
    getNodeColor,
  ]);

  useEffect(() => {
    renderGraph();

    // Handle window resize
    const handleResize = () => {
      renderGraph();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [renderGraph]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-sidebar)]">
        <div className="text-[var(--color-text-secondary)]">
          Loading graph...
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--color-sidebar)] text-center px-8">
        <div className="w-16 h-16 mb-4 text-[var(--color-text-tertiary)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="18" r="3" />
            <line x1="9" y1="6" x2="15" y2="6" />
            <line x1="6" y1="9" x2="6" y2="15" />
            <line x1="18" y1="9" x2="18" y2="15" />
            <line x1="9" y1="18" x2="15" y2="18" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">
          No connections yet
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
          Create links between notes using{" "}
          <code className="px-1 py-0.5 bg-[var(--color-surface)] rounded">
            [[Note Title]]
          </code>{" "}
          syntax to see them visualized here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 relative bg-[var(--color-sidebar)] overflow-hidden"
    >
      {/* Header with controls */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            Graph View
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {filteredData.nodes.length} notes · {filteredData.edges.length}{" "}
            links
            {tagFilter && ` · #${tagFilter}`}
            {viewMode === "local" && " · Local view"}
          </p>
        </div>
      </div>

      {/* Controls bar */}
      <div className="absolute top-16 left-4 right-4 z-10">
        <GraphControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
        />
      </div>

      {/* D3 SVG canvas */}
      <svg ref={svgRef} className="w-full h-full" />

      {/* Hover preview */}
      {hoveredNodeId && <GraphNodePreview nodeId={hoveredNodeId} />}

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 text-xs text-[var(--color-text-tertiary)]">
        Scroll to zoom · Drag to pan · Click node to open · Shift+click to pin
      </div>
    </div>
  );
}
