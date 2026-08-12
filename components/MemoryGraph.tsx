"use client";
import { useMemo } from "react";
import type { MemoryEdge, MemoryNode, NodeKind, Scenario } from "@/lib/types";

const KIND_GLYPH: Record<NodeKind, string> = { source: "S", memory: "M", derived: "D", agent: "A", decision: "✓", action: "$" };

const KIND_LABEL: Record<NodeKind, string> = {
  source: "source",
  memory: "memory",
  derived: "derived",
  agent: "agent",
  decision: "decision",
  action: "action",
};

export function nodeTone(status: MemoryNode["status"]): "ok" | "hot" | "muted" {
  if (status === "trusted" || status === "active") return "ok";
  if (["revoked", "quarantined", "invalidated", "cancelled", "repaired", "requires_review"].includes(status)) return "muted";
  return "hot";
}

export function isContaminated(status: MemoryNode["status"]): boolean {
  return status === "suspect";
}

function shapeFor(kind: NodeKind, r: number): React.ReactNode {
  const R = r;
  switch (kind) {
    case "source":
      return <rect x={-R} y={-R} width={R * 2} height={R * 2} rx={7} />;
    case "memory":
      return <circle r={R} />;
    case "derived":
      return <path d={`M 0 ${-R} L ${R} 0 L 0 ${R} L ${-R} 0 Z`} />;
    case "agent":
      return <path d={`M 0 ${-R} L ${R * 0.87} ${-R * 0.5} L ${R * 0.87} ${R * 0.5} L 0 ${R} L ${-R * 0.87} ${R * 0.5} L ${-R * 0.87} ${-R * 0.5} Z`} />;
    case "decision":
      return <rect x={-R * 1.25} y={-R * 0.55} width={R * 2.5} height={R * 1.1} rx={R * 0.55} />;
    case "action":
      return <path d={`M 0 ${-R} L ${R * 0.95} ${R * 0.7} L ${-R * 0.95} ${R * 0.7} Z`} />;
    default:
      return <circle r={R} />;
  }
}

type MemoryGraphProps = {
  scenario: Scenario;
  selected?: string;
  onSelect: (id: string) => void;
  blastIds?: Set<string>;
  blastStatus?: Record<string, string>;
  repairing?: boolean;
};

export function MemoryGraph({ scenario, selected, onSelect, blastIds, blastStatus, repairing }: MemoryGraphProps) {
  const byId = useMemo(() => new Map(scenario.nodes.map((n) => [n.id, n])), [scenario.nodes]);

  const depthMap = useMemo(() => {
    const root = scenario.nodes.find((n) => n.kind === "memory" || n.kind === "derived") ?? scenario.nodes[0];
    if (!root) return new Map<string, number>();
    const depths = new Map<string, number>([[root.id, 0]]);
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of scenario.edges) {
        if (edge.from === current && !depths.has(edge.to)) {
          depths.set(edge.to, (depths.get(current) ?? 0) + 1);
          queue.push(edge.to);
        }
      }
    }
    return depths;
  }, [scenario]);

  const inBlast = (id: string) => blastIds?.has(id) ?? false;
  const affectedBy: (id: string) => string | undefined = (id) => (blastStatus ? blastStatus[id] : undefined);

  return (
    <div className="graphWrap">
      <svg className="graph" viewBox="0 0 900 440" role="img" aria-label="Living causal memory graph — sources, memories, agents, decisions, actions and their influence edges">
        <defs>
          <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,249,233,.07)" strokeWidth="1" />
          </pattern>
          <marker id="arrow-retrieved" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
          </marker>
          <marker id="arrow-influenced" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--danger)" />
          </marker>
          <marker id="arrow-produced" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {scenario.edges.map((edge) => {
          const a = byId.get(edge.from);
          const b = byId.get(edge.to);
          if (!a || !b) return null;
          const contaminated = isContaminated(a.status) || inBlast(a.id);
          const repairingEdge = repairing === true;
          const edgeClass = [
            "edge",
            `rel-${edge.relation}`,
            contaminated ? "hot" : "",
            repairingEdge ? "repairing" : "",
          ].filter(Boolean).join(" ");
          const marker = edge.relation === "retrieved" ? "url(#arrow-retrieved)" : edge.relation === "produced" ? "url(#arrow-produced)" : "url(#arrow-influenced)";
          return (
            <g key={edge.id} className={edgeClass}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd={marker} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} className="edgeLabel">
                {edge.relation}
              </text>
            </g>
          );
        })}

        {scenario.nodes.map((node) => {
          const selectedNode = selected === node.id;
          const tone = nodeTone(node.status);
          const inRadius = inBlast(node.id);
          const target = affectedBy(node.id);
          const depth = depthMap.get(node.id) ?? 0;
          return (
            <g
              key={node.id}
              className={["node", `tone-${tone}`, inRadius ? "inBlast" : "", repairing ? "repairing" : ""].filter(Boolean).join(" ")}
              style={repairing ? { transitionDelay: `${Math.min(depth * 90, 700)}ms` } : undefined}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`${KIND_LABEL[node.kind]} ${node.label}, status ${node.status}${inRadius ? `, in blast radius (${target ?? "affected"})` : ""}`}
              transform={`translate(${node.x},${node.y})`}
            >
              {selectedNode && <circle r={35} className="nodeRing" aria-hidden="true" />}
              {inRadius && <circle r={31} className="blastRing" aria-hidden="true" />}
              <g className="nodeShape" aria-hidden="true">{shapeFor(node.kind, 25)}</g>
              <text textAnchor="middle" y="4" className="nodeGlyph" aria-hidden="true">
                {KIND_GLYPH[node.kind]}
              </text>
              {inRadius && target && (
                <text textAnchor="middle" y={-38} className="blastTag" aria-hidden="true">
                  {target.toUpperCase()}
                </text>
              )}
              <text textAnchor="middle" y="46" className="nodeLabel">
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
