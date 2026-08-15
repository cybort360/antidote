"use client";
import { useCallback, useEffect, useState } from "react";

type AuditEvent = {
  id: string;
  eventType: string;
  actor: string;
  objectId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

const SNAPSHOT_EVENTS: AuditEvent[] = [
  { id: "snapshot-audit-09", eventType: "repair.previewed", actor: "security-agent-09", objectId: "m-184", payload: { memories: 2, decisions: 2, actions: 1, execute: false }, createdAt: "2026-07-01T00:04:30.000Z" },
  { id: "snapshot-audit-08", eventType: "contamination.detected", actor: "security-verifier", objectId: "m-184", payload: { severity: "high", verdict: "suspect" }, createdAt: "2026-07-01T00:04:05.000Z" },
  { id: "snapshot-audit-07", eventType: "memory.derived", actor: "operations-agent-04", objectId: "m-229", payload: { parent: "m-211", status: "suspect" }, createdAt: "2026-07-01T00:03:30.000Z" },
  { id: "snapshot-audit-06", eventType: "action.prepared", actor: "finance-agent-07", objectId: "act-91", payload: { amount: 24000, currency: "USD", simulated: true }, createdAt: "2026-07-01T00:02:45.000Z" },
  { id: "snapshot-audit-05", eventType: "decision.recorded", actor: "finance-agent-07", objectId: "d-452", payload: { memoryIds: ["m-184"], status: "suspect" }, createdAt: "2026-07-01T00:02:30.000Z" },
  { id: "snapshot-audit-04", eventType: "memory.retrieved", actor: "finance-agent-07", objectId: "m-184", payload: { similarity: 0.88, session: "sess-fin" }, createdAt: "2026-07-01T00:02:00.000Z" },
  { id: "snapshot-audit-03", eventType: "decision.recorded", actor: "procurement-agent-03", objectId: "d-441", payload: { memoryIds: ["m-184"], status: "suspect" }, createdAt: "2026-07-01T00:01:30.000Z" },
  { id: "snapshot-audit-02", eventType: "memory.retrieved", actor: "procurement-agent-03", objectId: "m-184", payload: { similarity: 0.91, session: "sess-proc" }, createdAt: "2026-07-01T00:01:00.000Z" },
  { id: "snapshot-audit-01", eventType: "memory.ingested", actor: "policy-sync", objectId: "m-184", payload: { source: "vendor-policy.pdf", status: "suspect" }, createdAt: "2026-07-01T00:00:30.000Z" },
];

export function AuditView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "snapshot">("loading");

  const load = useCallback(() => {
    setStatus("loading");
    fetch("/api/audit?limit=400", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setEvents(data.events ?? []);
        setStatus("ready");
      })
      .catch(() => {
        setEvents(SNAPSHOT_EVENTS);
        setStatus("snapshot");
      });
  }, []);

  useEffect(load, [load]);

  return (
    <section className="view">
      <header className="viewHead">
        <div>
          <p className="eyebrow">OPERATIONS LOG / IMMUTABLE LEDGER</p>
          <h2>Audit trail</h2>
          <p className="lede">Every consequential write is appended to the audit ledger. This includes ingestion, retrieval, decisions, verdicts, contamination, repairs, and MCP operations. Nothing is ever deleted.</p>
        </div>
      </header>

      {status === "loading" && <p className="emptyNote">reading the ledger…</p>}
      {status === "snapshot" && <p className="caseDataNotice"><strong>CASE SNAPSHOT</strong><span>The authenticated ledger is unavailable in this browser session. Showing the redacted Zenith incident record.</span></p>}
      {status === "ready" && events.length === 0 && <p className="emptyNote">the ledger is empty.</p>}

      {(status === "ready" || status === "snapshot") && events.length > 0 && (
        <div className="ledger" role="table" aria-label="Audit trail">
          <div className="ledgerRow ledgerHead" role="row">
            <span role="columnheader">WHEN</span>
            <span role="columnheader">EVENT</span>
            <span role="columnheader">ACTOR</span>
            <span role="columnheader">OBJECT</span>
            <span role="columnheader">PAYLOAD</span>
          </div>
          {events.map((event) => (
            <div className="ledgerRow" role="row" key={event.id}>
              <span role="cell" className="mono">
                {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span role="cell" className="ledgerEvent">
                {event.eventType}
              </span>
              <span role="cell" className="mono">
                {event.actor}
              </span>
              <span role="cell" className="mono mutedText">
                {event.objectId ?? "Not recorded"}
              </span>
              <span role="cell" className="ledgerPayload">
                {JSON.stringify(event.payload).slice(0, 96)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
