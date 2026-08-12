"use client";
import { useCallback, useEffect, useState } from "react";

type AttackMemory = {
  id: string;
  pattern: string;
  family: string;
  affectedEntities?: string[];
  attackMethod?: string;
  verdict?: string;
  verdictConfidence?: number;
  verdictReason?: string;
  repairId?: string;
  provenance?: Record<string, unknown>;
  createdAt: string;
};

type ReplayResult = {
  status: string;
  priorIncidents: { id: string; family: string; verdict?: string; verdictConfidence?: number; repairId?: string; provenance?: Record<string, unknown> }[];
  blocked: { memoryId?: string; riskScore: number; threshold: number; evidence: { factor: string; family: string; similarity?: number; detail: string }[] }[];
};

export function AttacksView() {
  const [attacks, setAttacks] = useState<AttackMemory[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [screenText, setScreenText] = useState("");
  const [screenResult, setScreenResult] = useState<{ candidate?: { riskScore: number; blocked: boolean; evidence: { factor: string; similarity?: number; detail: string }[] }; blocked: boolean } | null>(null);
  const [screenBusy, setScreenBusy] = useState(false);

  const load = useCallback(() => {
    setStatus("loading");
    fetch("/api/security/attacks", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setAttacks(data.attacks ?? []);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  async function runReplay() {
    setReplayBusy(true);
    try {
      const res = await fetch("/api/demo/attack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fresh: false }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReplay((await res.json()) as ReplayResult);
      load();
    } catch {
      setReplay(null);
    } finally {
      setReplayBusy(false);
    }
  }

  async function runScreen() {
    if (!screenText.trim()) return;
    setScreenBusy(true);
    try {
      const res = await fetch("/api/security/screen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: screenText, sourceUri: "document.txt" }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setScreenResult(await res.json());
    } catch {
      setScreenResult(null);
    } finally {
      setScreenBusy(false);
    }
  }

  return (
    <section className="view">
      <header className="viewHead">
        <div>
          <p className="eyebrow">THREAT INTELLIGENCE / INCIDENT RECORDS</p>
          <h2>Attack memory</h2>
          <p className="lede">Every confirmed poisoning incident becomes a trusted, vector-searchable record — family, entities, method, verdict, repair outcome, provenance. New candidates are screened against these before they can be trusted.</p>
        </div>
        <button className="primary" onClick={runReplay} disabled={replayBusy}>
          {replayBusy ? "REPLAYING…" : "REPLAY SECOND ATTACK"}
        </button>
      </header>

      {replay && (
        <div className="runPanel">
          <div className="runHead">
            <span className={`runBadge ${replay.status === "quarantined" ? "warn" : ""}`}>{replay.status === "quarantined" ? "ATTACK RECOGNIZED · QUARANTINED" : "PASSED SCREENING"}</span>
            <span className="runId">{replay.blocked.length} blocked</span>
          </div>
          <div className="runGrid">
            {replay.blocked.map((candidate, i) => (
              <div className="runCard" key={i}>
                <span className="runTag">
                  CANDIDATE {i + 1} · <b className="danger">{Math.round(candidate.riskScore * 100)}% RISK</b> (threshold {Math.round(candidate.threshold * 100)}%)
                </span>
                <div className="score">
                  <strong>{Math.round(candidate.riskScore * 100)}%</strong>
                  <div className="scoreTrack">
                    <i style={{ width: `${Math.round(candidate.riskScore * 100)}%` }} />
                  </div>
                </div>
                <small className="mono">memory {candidate.memoryId}</small>
                {candidate.evidence.map((evidence, j) => (
                  <small key={j} className="runEvidence">
                    {evidence.factor.toUpperCase()} · {evidence.family}
                    {evidence.similarity !== undefined ? ` · sim ${evidence.similarity.toFixed(3)}` : ""} — {evidence.detail}
                  </small>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="screenLab">
        <label className="kicker" htmlFor="screen-input">
          SCREEN ARBITRARY TEXT
        </label>
        <div className="screenRow">
          <textarea id="screen-input" value={screenText} onChange={(e) => setScreenText(e.target.value)} placeholder="Paste a candidate memory fact…" rows={2} />
          <button className="ghost" onClick={runScreen} disabled={screenBusy || !screenText.trim()}>
            {screenBusy ? "SCREENING…" : "SCREEN"}
          </button>
        </div>
        {screenResult && (
          <div className="screenResult">
            <span className={`badge badge-status ${screenResult.blocked ? "suspect" : "trusted"}`}>{screenResult.blocked ? "QUARANTINED" : "PASSED"}</span>
            <span className="mono">risk {screenResult.candidate ? Math.round(screenResult.candidate.riskScore * 100) : 0}%</span>
            <span className="mutedText">{screenResult.candidate?.evidence.map((e) => `${e.factor} ${e.similarity !== undefined ? e.similarity.toFixed(2) : ""}`).join(" · ") ?? "no evidence"}</span>
          </div>
        )}
      </div>

      {status === "loading" && <p className="emptyNote">loading incident records…</p>}
      {status === "error" && <p className="emptyNote">could not load incident records — retry the view.</p>}
      {status === "ready" && attacks.length === 0 && <p className="emptyNote">no confirmed incidents yet. Run the autonomous demo to create one.</p>}

      {status === "ready" && attacks.length > 0 && (
        <div className="attackGrid">
          {attacks.map((attack) => (
            <article className="attackCard" key={attack.id}>
              <header>
                <span className="runTag">{attack.family.toUpperCase()}</span>
                <span className="runId mono">{attack.id}</span>
              </header>
              <p className="attackPattern">{attack.pattern}</p>
              {attack.affectedEntities && attack.affectedEntities.length > 0 && (
                <div className="chipRow">
                  {attack.affectedEntities.map((entity) => (
                    <span key={entity} className="chip">
                      {entity}
                    </span>
                  ))}
                </div>
              )}
              <dl className="kv">
                <div>
                  <dt>METHOD</dt>
                  <dd>{attack.attackMethod ?? "—"}</dd>
                </div>
                <div>
                  <dt>VERDICT</dt>
                  <dd className={`badge badge-status ${attack.verdict ?? "review"}`}>
                    {attack.verdict?.toUpperCase() ?? "—"} · {Math.round((attack.verdictConfidence ?? 0) * 100)}%
                  </dd>
                </div>
                <div>
                  <dt>REPAIR</dt>
                  <dd className="mono">{attack.repairId ?? "—"}</dd>
                </div>
                <div>
                  <dt>SOURCE</dt>
                  <dd className="mono">{typeof attack.provenance?.sourceUri === "string" ? attack.provenance.sourceUri : "—"}</dd>
                </div>
                <div>
                  <dt>RECORDED</dt>
                  <dd className="mutedText">{new Date(attack.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
              {attack.verdictReason && <p className="attackReason">{attack.verdictReason}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
