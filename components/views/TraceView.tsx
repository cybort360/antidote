"use client";
import { useCallback, useEffect, useState } from "react";

const CAPABILITIES = ["list_tables", "get_schema", "get_memory_lineage", "get_blast_radius", "get_repair_status"] as const;

type TraceOperation = {
  id: string;
  agentId: string;
  capability: string;
  status: "completed" | "failed";
  durationMs: number;
  result?: unknown;
  error?: string;
  createdAt: string;
};

function summarizeEvidence(operation: TraceOperation): string {
  if (operation.status === "failed") return operation.error ?? "operation failed";
  const result = operation.result as Record<string, unknown> | undefined;
  if (!result) return "no evidence returned";
  if (operation.capability === "get_memory_lineage") {
    return `source ${result.source ? (result.source as { id?: string }).id : "—"} · ${String(result.nodeCount ?? 0)} nodes · ${String((result.decisions as unknown[] | undefined)?.length ?? 0)} decisions · ${String((result.derivedMemories as unknown[] | undefined)?.length ?? 0)} derived`;
  }
  if (operation.capability === "get_blast_radius") {
    return `${String(result.memories ?? 0)} memories · ${String((result.decisions as unknown[] | undefined)?.length ?? 0)} decisions · ${String((result.actionsToCancel as unknown[] | undefined)?.length ?? 0)} to cancel · ${String((result.actionsRequiringReview as unknown[] | undefined)?.length ?? 0)} for review`;
  }
  if (operation.capability === "get_repair_status") {
    return `${String((result.repairJobs as unknown[] | undefined)?.length ?? 0)} repair jobs · ${String(result.pendingReevaluations ?? 0)} pending re-evaluations`;
  }
  if (operation.capability === "list_tables") {
    return `${String((result.tables as unknown[] | undefined)?.length ?? 0)} tables · ${JSON.stringify(result.rowCounts)}`;
  }
  return JSON.stringify(result).slice(0, 140);
}

export function TraceView({ memoryIdHint }: { memoryIdHint?: string }) {
  const [operations, setOperations] = useState<TraceOperation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [provider, setProvider] = useState<string>("");
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus("loading");
    fetch("/api/trace", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setOperations(data.operations ?? []);
        setProvider(data.provider ?? "");
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  async function run(capability: (typeof CAPABILITIES)[number]) {
    setRunning(capability);
    try {
      const res = await fetch("/api/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capability, memoryId: memoryIdHint ?? "m-184" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { operation: TraceOperation };
      setOperations((ops) => [data.operation, ...ops].slice(0, 30));
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="view">
      <header className="viewHead">
        <div>
          <p className="eyebrow">GOVERNED MCP / FORENSIC ACCESS</p>
          <h2>Agent trace</h2>
          <p className="lede">
            The Security/Forensics agent invokes read-only, narrowly scoped MCP capabilities. Every operation records when it occurred, which capability ran, and the resulting database evidence — redacted, never exposed.
          </p>
        </div>
        <span className="providerChip">provider: {provider || "simulated-local-store"}</span>
      </header>

      <div className="traceButtons commandButtons">
        {CAPABILITIES.map((capability) => (
          <button key={capability} className="ghost traceButton" onClick={() => run(capability)} disabled={running !== null}>
            {running === capability ? "RUNNING…" : capability.replace(/_/g, " ").toUpperCase()}
          </button>
        ))}
      </div>

      {status === "loading" && <p className="emptyNote">reading the trace…</p>}
      {status === "error" && <p className="emptyNote">could not read the trace — retry the view.</p>}
      {status === "ready" && operations.length === 0 && <p className="emptyNote">no MCP operations recorded yet — invoke a capability above.</p>}

      {status === "ready" && operations.length > 0 && (
        <div className="runPanel">
          {operations.slice(0, 1).map((op) => (
            <div className="runCard" key={op.id}>
              <span className="runTag">
                {op.capability.replace(/_/g, " ").toUpperCase()} · <b className={op.status === "failed" ? "danger" : ""}>{op.status.toUpperCase()}</b> · {op.durationMs}ms
              </span>
              <small className="runEvidence">{summarizeEvidence(op)}</small>
            </div>
          ))}
          <div className="traceList" role="list" aria-label="MCP operation trace">
            {operations.slice(0, 12).map((op) => (
              <div className="traceRow" role="listitem" key={op.id}>
                <span className="traceTime">{new Date(op.createdAt).toLocaleTimeString()}</span>
                <span className="traceCap">{op.capability}</span>
                <span className={`traceStatus ${op.status}`}>{op.status}</span>
                <span className="traceMeta">{op.durationMs}ms · {op.agentId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
