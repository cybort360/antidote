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

export function AuditView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="view">
      <header className="viewHead">
        <div>
          <p className="eyebrow">OPERATIONS LOG / IMMUTABLE LEDGER</p>
          <h2>Audit trail</h2>
          <p className="lede">Every consequential write — ingestion, retrieval, decisions, verdicts, contamination, repairs, MCP operations — is appended to the audit ledger. Nothing is ever deleted.</p>
        </div>
      </header>

      {status === "loading" && <p className="emptyNote">reading the ledger…</p>}
      {status === "error" && <p className="emptyNote">could not read the ledger — retry the view.</p>}
      {status === "ready" && events.length === 0 && <p className="emptyNote">the ledger is empty.</p>}

      {status === "ready" && events.length > 0 && (
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
                {event.objectId ?? "—"}
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
