"use client";
import { useEffect, useState } from "react";
import type { MemoryNode, Scenario } from "@/lib/types";

type Lineage = {
  source?: { id: string; label: string; status: string } | null;
  memory?: { id: string; status: string; createdAt?: string; contentHash?: string; sourceUri?: string };
  retrievals?: { id: string; agentId: string; similarity: number; createdAt: string }[];
  decisions?: { id: string; agentId: string; memoryIds: string[]; summary: string; status: string }[];
  actions?: { id: string; decisionId: string; actionType: string; status: string; createdAt: string }[];
  derived?: { id: string; status: string }[];
  verdicts?: { id: string; verdict: string; confidence: number; reason?: string; createdAt: string }[];
  contaminations?: { id: string; severity: string; reason?: string; detectedBy: string; createdAt: string }[];
  nodes?: { id: string; kind: string }[];
};

type Dependency = { id: string; kind: string; label: string; depth: number; relation: string };

type InspectorProps = {
  node: MemoryNode;
  scenario: Scenario;
  onSimulate: () => void;
  busy: boolean;
};

function fmtTime(iso?: string): string {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Inspector({ node, onSimulate, busy }: InspectorProps) {
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "snapshot">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setLineage(null);
    setDependencies([]);
    const memoryId = node.id;
    Promise.all([
      fetch(`/api/lineage?memoryId=${encodeURIComponent(memoryId)}`, { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)),
      fetch(`/api/dependencies?memoryId=${encodeURIComponent(memoryId)}&direction=down&maxDepth=10`, { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([lineageBody, depBody]) => {
        if (cancelled) return;
        setLineage(lineageBody as Lineage | null);
        setDependencies((depBody?.dependencies ?? []) as Dependency[]);
        setState(lineageBody ? "ready" : "snapshot");
      })
      .catch(() => {
        if (!cancelled) setState("snapshot");
      });
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const isMemoryKind = node.kind === "memory" || node.kind === "derived";
  const creator =
    node.kind === "agent"
      ? node.label
      : node.kind === "decision"
        ? lineage?.decisions?.find((d) => d.id === node.id)?.agentId ?? "Not recorded"
        : node.kind === "action"
          ? lineage?.actions?.find((a) => a.id === node.id)?.decisionId ?? "Not recorded"
          : lineage?.memory?.sourceUri ?? node.detail;

  const descendantCounts = dependencies.reduce<Record<string, number>>((acc, dep) => {
    acc[dep.kind] = (acc[dep.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="inspector" aria-label={`Forensic inspector for ${node.label}`}>
      <header className="inspectorHead">
        <div>
          <p className="kicker">FORENSIC OBJECT</p>
          <h3>{node.label}</h3>
          <p className="nodeDetail">{node.detail}</p>
        </div>
        <div className="badgeRow">
          <span className={`badge badge-kind`}>{node.kind}</span>
          <span className={`badge badge-status ${node.status}`}>{node.status}</span>
        </div>
      </header>

      <section className="inspectorSection">
        <span className="inspectorLabel">TRUST / CONFIDENCE</span>
        <div className="score">
          <strong>{Math.round(node.trust)}%</strong>
          <div className="scoreTrack">
            <i style={{ width: `${Math.min(100, node.trust)}%` }} />
          </div>
        </div>
      </section>

      <section className="inspectorSection">
        <span className="inspectorLabel">PROVENANCE</span>
        <dl className="kv">
          <div>
            <dt>CREATOR</dt>
            <dd>{creator}</dd>
          </div>
          <div>
            <dt>SOURCE</dt>
            <dd>{lineage?.memory?.sourceUri ?? lineage?.source?.label ?? node.detail}</dd>
          </div>
          <div>
            <dt>CREATED</dt>
            <dd>{fmtTime(lineage?.memory?.createdAt)}</dd>
          </div>
          <div>
            <dt>CONTENT HASH</dt>
            <dd className="mono">{lineage?.memory?.contentHash ? lineage.memory.contentHash.slice(0, 16) + "…" : "Not recorded"}</dd>
          </div>
        </dl>
      </section>

      <section className="inspectorSection">
        <span className="inspectorLabel">RETRIEVAL HISTORY</span>
        {lineage && lineage.retrievals && lineage.retrievals.length > 0 ? (
          <ul className="historyList">
            {lineage.retrievals.slice(0, 6).map((retrieval) => (
              <li key={retrieval.id}>
                <span className="mono">{retrieval.agentId}</span>
                <span>sim {retrieval.similarity.toFixed(3)}</span>
                <span className="mutedText">{fmtTime(retrieval.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="emptyNote">{state === "loading" ? "reading retrieval log…" : "no retrieval events recorded"}</p>
        )}
      </section>

      <section className="inspectorSection">
        <span className="inspectorLabel">DESCENDANTS</span>
        {Object.keys(descendantCounts).length > 0 ? (
          <div className="chipRow">
            {Object.entries(descendantCounts).map(([kind, count]) => (
              <span key={kind} className="chip">
                {count} {kind}
              </span>
            ))}
            <span className="chip chipMuted">max depth {dependencies.reduce((max, d) => Math.max(max, d.depth), 0)}</span>
          </div>
        ) : (
          <p className="emptyNote">{state === "loading" ? "traversing dependencies…" : "no downstream dependents"}</p>
        )}
      </section>

      <section className="inspectorSection">
        <span className="inspectorLabel">AFFECTED DECISIONS</span>
        {lineage && lineage.decisions && lineage.decisions.length > 0 ? (
          <ul className="historyList">
            {lineage.decisions.slice(0, 6).map((decision) => (
              <li key={decision.id}>
                <span className="mono">{decision.id}</span>
                <span>{decision.summary}</span>
                <span className="mutedText">inputs {decision.memoryIds.length}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="emptyNote">{state === "loading" ? "resolving decisions…" : "no influencing decisions"}</p>
        )}
      </section>

      <section className="inspectorSection">
        <span className="inspectorLabel">EVIDENCE</span>
        {lineage && (lineage.verdicts?.length || lineage.contaminations?.length) ? (
          <ul className="historyList">
            {lineage.verdicts?.slice(0, 3).map((verdict) => (
              <li key={verdict.id}>
                <span className={`badge badge-status ${verdict.verdict}`}>{verdict.verdict}</span>
                <span className="mutedText">conf {verdict.confidence.toFixed(2)}</span>
                <span className="mutedText">{fmtTime(verdict.createdAt)}</span>
              </li>
            ))}
            {lineage.contaminations?.slice(0, 3).map((contamination) => (
              <li key={contamination.id}>
                <span className={`badge badge-status ${contamination.severity === "critical" ? "revoked" : "suspect"}`}>{contamination.severity}</span>
                <span className="mutedText">{contamination.reason ?? "contamination event"}</span>
                <span className="mutedText">{contamination.detectedBy}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="emptyNote">{state === "loading" ? "collecting evidence…" : "no security evidence on record"}</p>
        )}
      </section>

      <section className="inspectorSection">
        <span className="inspectorLabel">STATUS</span>
        <dl className="kv">
          <div>
            <dt>LIFECYCLE</dt>
            <dd className={`badge badge-status ${node.status}`}>{node.status}</dd>
          </div>
          <div>
            <dt>TYPE</dt>
            <dd>{node.kind}</dd>
          </div>
          <div>
            <dt>INFLUENCED DECISIONS</dt>
            <dd>{node.usedBy ?? "Not recorded"}</dd>
          </div>
        </dl>
      </section>

      {isMemoryKind && (
        <button className="ghost inspectorSimulate" onClick={onSimulate} disabled={busy}>
          SIMULATE REVOCATION OF {node.id}
        </button>
      )}
    </div>
  );
}
