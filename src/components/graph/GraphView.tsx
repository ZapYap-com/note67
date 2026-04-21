import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import { useGraphStore } from "../../stores/graphStore";
import { GraphNodePreview } from "./GraphNodePreview";
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

  const { nodes, edges, fetchGraphData, setHoveredNode, hoveredNodeId, loading } =
    useGraphStore();

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  const renderGraph = useCallback(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous render
    svg.selectAll("*").remove();

    // Set SVG dimensions
    svg.attr("width", width).attr("height", height);

    // Create container group for zoom/pan
    const g = svg.append("g");

    // Setup zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Create a working copy of nodes and edges for D3
    const nodesCopy: GraphNode[] = nodes.map((n) => ({ ...n }));
    const edgesCopy: GraphEdge[] = edges.map((e) => ({ ...e }));

    // Create force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodesCopy)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edgesCopy)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
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
      .attr("stroke-width", 1);

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

    // Node circles - size based on link count
    node
      .append("circle")
      .attr("r", (d) => Math.max(6, Math.min(20, 6 + d.link_count * 2)))
      .attr("fill", "var(--color-accent)")
      .attr("stroke", "var(--color-background)")
      .attr("stroke-width", 2);

    // Node labels
    node
      .append("text")
      .text((d) => d.title)
      .attr("x", (d) => Math.max(6, Math.min(20, 6 + d.link_count * 2)) + 6)
      .attr("y", 4)
      .attr("font-size", "12px")
      .attr("fill", "var(--color-text)")
      .attr("cursor", "pointer");

    // Click to navigate
    node.on("click", (_event, d) => {
      onSelectNote(d.id);
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
      node.select("circle").attr("opacity", 1);
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
      d.fx = null;
      d.fy = null;
    }

    // Center the view initially
    const initialTransform = d3.zoomIdentity.translate(0, 0).scale(1);
    svg.call(zoom.transform, initialTransform);
  }, [nodes, edges, onSelectNote, setHoveredNode]);

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
        <div className="text-[var(--color-text-secondary)]">Loading graph...</div>
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
          Create links between notes using <code className="px-1 py-0.5 bg-[var(--color-surface)] rounded">[[Note Title]]</code> syntax to see them visualized here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 relative bg-[var(--color-sidebar)] overflow-hidden"
    >
      {/* Header */}
      <div className="absolute top-4 left-4 z-10">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Graph View
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {nodes.length} notes · {edges.length} links
        </p>
      </div>

      {/* Refresh button */}
      <button
        onClick={() => fetchGraphData()}
        className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
        title="Refresh graph"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>

      {/* D3 SVG canvas */}
      <svg ref={svgRef} className="w-full h-full" />

      {/* Hover preview */}
      {hoveredNodeId && <GraphNodePreview nodeId={hoveredNodeId} />}

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 text-xs text-[var(--color-text-tertiary)]">
        Scroll to zoom · Drag to pan · Click node to open
      </div>
    </div>
  );
}
