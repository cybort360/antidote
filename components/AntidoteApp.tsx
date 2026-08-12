"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { demoScenario } from "@/lib/demo";
import { ContainmentScene } from "./ContainmentScene";
import { MemoryGraph } from "./MemoryGraph";
import { Inspector } from "./Inspector";
import { AttacksView } from "./views/AttacksView";
import { AuditView } from "./views/AuditView";
import { TraceView } from "./views/TraceView";
import type { Scenario } from "@/lib/types";

type ViewId = "graph" | "attacks" | "audit" | "trace";
type Phase = Scenario["phase"];
type DemoRunStatus = "idle" | "running" | "done" | "error";

type DemoRunResult = {
  runId: string;
  mode: string;
  procurement: { poisonedMemoryId: string; decisionId: string; decisionMemoryIds: string[] };
  finance: { retrievals: unknown[]; decisionId?: string; decisionMemoryIds: string[]; actionType?: string; payload?: { amount?: number; simulated?: boolean } };
  operations: { derivedMemoryId: string; decisionMemoryIds: string[] };
  security: { verdict: string; blastRadius: { memoryIds: string[]; decisionIds: string[]; actionIds: string[]; needsReevaluation: string[] }; repair?: { executed: boolean } };
};

type BlastPreview = {
  ids: Set<string>;
  status: Record<string, string>;
  counts: { memories: number; decisions: number; actions: number; agents: number };
};

const TRACE_STAGES = [
  {
    signal: "MEMORY INTAKE / T+00",
    title: ["ONE FALSE", "MEMORY", "ENTERS TRUST."],
    body: "A malicious vendor document becomes M-184. The agent stores the claim as trusted memory and carries its source into every later decision.",
    metric: "01",
    metricLabel: "compromised root",
  },
  {
    signal: "RETRIEVAL / T+04",
    title: ["TRUST", "BECOMES", "BEHAVIOR."],
    body: "Procurement and Finance retrieve the same poisoned fact. What looked like one bad row now shapes approvals, derived memory, and a pending transfer.",
    metric: "03",
    metricLabel: "decisions influenced",
  },
  {
    signal: "BLAST RADIUS / T+11",
    title: ["THE DAMAGE", "HAS A", "TOPOLOGY."],
    body: "ANTIDOTE follows recorded influence edges from M-184 to every dependent. The red path shows evidence of impact, not a decorative network.",
    metric: "09",
    metricLabel: "dependents traced",
  },
  {
    signal: "RECOVERY PLAN / PREVIEW",
    title: ["TRACE FIRST.", "REPAIR", "AS ONE."],
    body: "Preview the full state change before execution. Revoke the root, quarantine descendants, invalidate decisions, and preserve the audit trail.",
    metric: "$24K",
    metricLabel: "pending action held",
  },
] as const;

const VIEWS: { id: ViewId; numeral: string; label: string }[] = [
  { id: "graph", numeral: "I", label: "CASE MAP" },
  { id: "attacks", numeral: "II", label: "ATTACKS" },
  { id: "audit", numeral: "III", label: "AUDIT" },
  { id: "trace", numeral: "IV", label: "TRACE" },
];

export default function AntidoteApp() {
  const [view, setView] = useState<ViewId>("graph");
  const [scenario, setScenario] = useState<Scenario>(() => demoScenario("infected"));
  const [scenarioState, setScenarioState] = useState<"loading" | "ready" | "fallback" | "error">("loading");
  const [phase, setPhase] = useState<Phase>("infected");
  const [selected, setSelected] = useState<string>("m-184");
  const [busy, setBusy] = useState(false);
  const [blast, setBlast] = useState<BlastPreview | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [runStatus, setRunStatus] = useState<DemoRunStatus>("idle");
  const [run, setRun] = useState<DemoRunResult | null>(null);
  const [traceProgress, setTraceProgress] = useState(0);
  const traceProgressRef = useRef(0);
  const traceRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<HTMLElement | null>(null);

  const loadScenario = useCallback(async () => {
    setScenarioState("loading");
    try {
      const res = await fetch("/api/scenario", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Scenario;
      setScenario(data);
      setPhase(data.phase);
      setScenarioState("ready");
      if (!data.nodes.some((n) => n.id === selected)) {
        const fallback = data.nodes.find((n) => n.kind === "memory" || n.kind === "derived");
        setSelected(fallback?.id ?? data.nodes[0]?.id ?? "m-184");
      }
    } catch {
      const fallback = demoScenario("infected");
      setScenario(fallback);
      setScenarioState("fallback");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadScenario();
  }, [loadScenario]);

  useEffect(() => {
    const section = traceRef.current;
    if (!section) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = section.getBoundingClientRect();
      const distance = Math.max(1, bounds.height - window.innerHeight);
      const next = Math.min(1, Math.max(0, -bounds.top / distance));
      if (Math.abs(next - traceProgressRef.current) > 0.002) {
        traceProgressRef.current = next;
        setTraceProgress(next);
      }
    };
    const requestUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [view]);

  const node = useMemo(() => scenario.nodes.find((n) => n.id === selected) ?? scenario.nodes[0], [scenario.nodes, selected]);
  const rootNode = useMemo(() => scenario.nodes.find((n) => n.kind === "memory" || n.kind === "derived"), [scenario.nodes]);
  const riskCritical = useMemo(() => scenario.nodes.some((n) => n.status === "suspect"), [scenario.nodes]);

  async function simulate(memoryId?: string) {
    const target = memoryId ?? selected;
    setBusy(true);
    setBlast(null);
    try {
      const res = await fetch("/api/revocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryId: target, execute: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { plan: { graph: { nodes: { id: string; status: string }[] }; memoryIds: string[]; decisionIds: string[]; actionIds: string[]; needsReevaluation: string[] } };
      const status: Record<string, string> = {};
      for (const graphNode of data.plan.graph.nodes) {
        if (graphNode.id === target) status[graphNode.id] = "revoked";
        else if (data.plan.memoryIds.includes(graphNode.id)) status[graphNode.id] = "quarantined";
        else if (data.plan.decisionIds.includes(graphNode.id)) status[graphNode.id] = "invalidated";
        else if (data.plan.actionIds.includes(graphNode.id)) status[graphNode.id] = "cancelled";
        else if (data.plan.needsReevaluation.includes(graphNode.id)) status[graphNode.id] = "reevaluate";
      }
      setBlast({
        ids: new Set(data.plan.graph.nodes.map((n) => n.id)),
        status,
        counts: { memories: data.plan.memoryIds.length, decisions: data.plan.decisionIds.length, actions: data.plan.actionIds.length, agents: data.plan.needsReevaluation.length },
      });
      setPhase("simulated");
    } catch {
      setBlast(null);
    } finally {
      setBusy(false);
    }
  }

  async function repair() {
    setBusy(true);
    try {
      const res = await fetch("/api/revocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryId: selected, execute: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRepairing(true);
      setTimeout(() => {
        setRepairing(false);
        setBlast(null);
        setPhase("repaired");
        loadScenario();
      }, 1200);
    } catch {
      setRepairing(false);
    } finally {
      setBusy(false);
    }
  }

  async function runDemo() {
    setBusy(true);
    setRunStatus("running");
    try {
      const res = await fetch("/api/demo/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repair: true, fresh: true }) });
      if (!res.ok) throw new Error(`demo run failed: ${res.status}`);
      const data: DemoRunResult = await res.json();
      setRun(data);
      setRunStatus("done");
      setPhase("infected");
      setBlast(null);
      await loadScenario();
      setSelected(data.procurement.poisonedMemoryId);
    } catch {
      setRunStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function resetSeededDemo() {
    setBusy(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seeded: true }) });
      if (!res.ok) throw new Error(`demo reset failed: ${res.status}`);
      setRun(null);
      setRunStatus("idle");
      setPhase("infected");
      setBlast(null);
      await loadScenario();
      setSelected(rootNode?.id ?? "m-184");
    } catch {
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }

  function resetView() {
    setPhase("infected");
    setBlast(null);
    setSelected(rootNode?.id ?? "m-184");
    loadScenario();
  }

  function inspectIncident() {
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function beginTrace() {
    const section = traceRef.current;
    if (!section) return;
    const sectionTop = window.scrollY + section.getBoundingClientRect().top;
    window.scrollTo({ top: sectionTop + window.innerHeight * 0.9, behavior: "smooth" });
  }

  function navigateFromFooter(nextView: ViewId) {
    setView(nextView);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    });
  }

  const tabIndex = VIEWS.findIndex((v) => v.id === view);
  const traceStageIndex = traceProgress < 0.22 ? 0 : traceProgress < 0.49 ? 1 : traceProgress < 0.76 ? 2 : 3;
  const traceStage = TRACE_STAGES[traceStageIndex];

  return (
    <main className="antidoteShell">
      <header className="topbar">
        <div className="brandWrap">
          <Link className="brand" href="/" aria-label="ANTIDOTE home">
            <span className="mark" aria-hidden="true"><i /></span>
            <span>ANTIDOTE</span>
          </Link>
          <span className="caseId">CASE {run?.runId ?? "ZX-017"}</span>
          <Link className="howEntryLink" href="/">HOW IT WORKS</Link>
        </div>
        <nav className="viewTabs" role="tablist" aria-label="Case views" aria-orientation="horizontal">
          {VIEWS.map((item, index) => (
            <button
              key={item.id}
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={view === item.id}
              aria-controls={`view-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = (index + (event.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length;
                  setView(VIEWS[next].id);
                }
              }}
            >
              <span className="tabNumeral">{item.numeral}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="system">
          <span className="pulse" aria-hidden="true" /> runtime <b>{scenarioState === "error" ? "DEGRADED" : "ONLINE"}</b>
        </div>
      </header>

      {view === "graph" && (
        <div id="view-graph" role="tabpanel" aria-labelledby="tab-graph">
          <section
            className={`traceLanding traceLanding-stage-${traceStageIndex}`}
            ref={traceRef}
            aria-labelledby="landing-title"
            style={{ "--trace-progress": traceProgress } as CSSProperties}
          >
            <div className="traceSticky">
              <div className="traceGrid" aria-hidden="true" />
              <div className="traceScene">
                <ContainmentScene progress={traceProgress} />
              </div>

              <div className="traceCopy" key={traceStageIndex}>
                <h1 id="landing-title">
                  {traceStage.title.map((line, index) => (
                    <span key={line} className={index === traceStage.title.length - 1 ? "traceAccent" : ""}>{line}</span>
                  ))}
                </h1>
                <p className="traceLede">{traceStage.body}</p>
                <div className="traceActions">
                  {traceStageIndex === 0 && <button className="landingPrimary" onClick={beginTrace}>TRACE THE DAMAGE</button>}
                  {traceStageIndex === 3 && <button className="landingPrimary" onClick={inspectIncident}>OPEN RECOVERY CONSOLE</button>}
                  <button className="landingSecondary" onClick={inspectIncident}>SKIP TO LIVE CASE <span aria-hidden="true">↓</span></button>
                </div>
              </div>

              <div className="traceReadout" aria-live="polite">
                <div className="traceReadoutHead">
                  <span className={traceStageIndex === 3 ? "traceStatePlan" : "traceStateHot"}>{traceStageIndex === 3 ? "READY TO SIMULATE" : "INFLUENCE ACTIVE"}</span>
                  <span>{run?.runId ?? "ZX-017"}</span>
                </div>
                <span className="traceReadoutSignal">{traceStage.signal}</span>
                <strong>{traceStage.metric}</strong>
                <span>{traceStage.metricLabel}</span>
                <p>{traceStageIndex === 3 ? "No state has changed. Enter the console to simulate and approve the repair." : "Scroll to follow one compromised fact through the system."}</p>
              </div>

              <ol className="traceRail" aria-label="Incident trace progress">
                {TRACE_STAGES.map((stage, index) => (
                  <li key={stage.signal} className={index === traceStageIndex ? "active" : index < traceStageIndex ? "complete" : ""}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{["INGEST", "PROPAGATE", "MAP", "RECOVER"][index]}</b>
                  </li>
                ))}
              </ol>

              <div className="traceScrollCue" aria-hidden="true"><span>{traceStageIndex === 3 ? "ENTER THE CASE" : "KEEP TRACING"}</span><i /></div>
            </div>
            <div className="traceTranscript">
              {TRACE_STAGES.map((stage) => <p key={stage.signal}>{stage.signal}. {stage.title.join(" ")} {stage.body}</p>)}
            </div>
          </section>

          <section className="recoveryIntro" ref={mapRef} aria-labelledby="recovery-title">
            <div>
              <h2 id="recovery-title">Trace the real chain. Preview the repair.</h2>
              <span>LIVE CASE / {run?.runId ?? "ZX-017"}</span>
            </div>
            <p>The narrative above explains the threat. The console below reads the live case state. Select a node, compute its blast radius, then approve the transactional repair.</p>
          </section>

          <section className="statusRail" aria-label="Case summary">
            <div>
              <span>CASE</span>
              <strong>{run?.runId ?? "#ZX-017"}</strong>
            </div>
            <div>
              <span>ROOT MEMORY</span>
              <strong>{rootNode?.label ?? "—"}</strong>
            </div>
            <div>
              <span>RISK</span>
              <strong className={riskCritical ? "danger" : ""}>{riskCritical ? "CRITICAL" : "MONITORED"}</strong>
            </div>
            <div>
              <span>DEPENDENTS</span>
              <strong>{rootNode?.descendants ?? "—"}</strong>
            </div>
            <div>
              <span>EXTERNAL ACTIONS</span>
              <strong>{scenario.nodes.filter((n) => n.kind === "action").length}</strong>
            </div>
          </section>

          <section className="workspace">
            <div className="stage">
              <div className="stageHead">
                <div>
                  <span className="stageCode">LIVE CASE TOPOLOGY</span>
                  <h2>Influence does not disappear.</h2>
                </div>
                <div className={`phase ${phase}`}>{phase === "repaired" ? "CONTAINED" : phase === "simulated" ? "SIMULATION READY" : "CONTAMINATION ACTIVE"}</div>
              </div>
              {scenarioState === "loading" ? (
                <div className="graphSkeleton" aria-label="loading case map" />
              ) : (
                <MemoryGraph
                  scenario={scenario}
                  selected={selected}
                  onSelect={setSelected}
                  blastIds={blast?.ids}
                  blastStatus={blast?.status}
                  repairing={repairing}
                />
              )}
              <div className="legend" aria-label="Graph legend">
                <span><i className="dot dangerDot" /> contaminated influence</span>
                <span><i className="dot okDot" /> trusted runtime</span>
                <span><i className="dot muteDot" /> revoked / repaired</span>
                <span><i className="dot blastDot" /> blast radius preview</span>
              </div>
              {scenarioState === "fallback" && <p className="emptyNote">live store unavailable — rendering offline case snapshot.</p>}
            </div>

            <aside className="forensic">
              {node ? (
                <Inspector node={node} scenario={scenario} onSimulate={() => simulate(node.id)} busy={busy} />
              ) : (
                <p className="emptyNote">no forensic object selected.</p>
              )}
            </aside>
          </section>

          <section className="command">
            <div>
              <h2>{phase === "repaired" ? "Influence chain repaired." : phase === "simulated" ? "Blast radius computed. Nothing changed yet." : `${selected} has escaped containment.`}</h2>
              <p>
                {phase === "repaired"
                  ? "Dependent memories were quarantined, decisions invalidated, pending actions cancelled, irreversible actions flagged for review, and affected agents enqueued for re-evaluation. History preserved."
                  : phase === "simulated"
                    ? `${blast ? `${blast.counts.memories} memories · ${blast.counts.decisions} decisions · ${blast.counts.actions} actions · ${blast.counts.agents} agents` : ""} will be affected. Execute repair to commit the state transition as one transaction.`
                    : "Deleting the row would leave decisions, derived memories, and external actions contaminated. Compute the causal blast radius before changing state."}
              </p>
            </div>
            <div className="commandButtons">
              {(phase === "infected" || phase === "simulated") && (
                <button className="ghost" onClick={() => simulate()} disabled={busy || repairing}>{phase === "simulated" ? "RECOMPUTE BLAST RADIUS" : "SIMULATE REVOCATION"}</button>
              )}
              {phase === "simulated" && (
                <button className="primary" onClick={repair} disabled={busy || repairing}>{repairing ? "REPAIRING…" : "EXECUTE REPAIR"}</button>
              )}
              {phase === "repaired" && (
                <button className="ghost" onClick={resetView}>REPLAY ATTACK</button>
              )}
            </div>
          </section>

          <section className="command runCommand">
            <div>
              <h2>Run the four-agent poisoning scenario.</h2>
              <p>Procurement ingests a malicious vendor document and forms a poisoned memory; Finance retrieves the derived approval and prepares a $24,000 transfer; Operations derives a trust memory; Security determines the source is compromised and repairs the chain.</p>
            </div>
            <div className="commandButtons">
              <button className="primary" onClick={runDemo} disabled={busy}>
                {runStatus === "running" ? "AGENTS RUNNING…" : runStatus === "done" ? "RUN DEMO AGAIN" : "RUN AUTONOMOUS DEMO"}
              </button>
              <button className="ghost" onClick={resetSeededDemo} disabled={busy}>RESET SEEDED DEMO</button>
            </div>
            {run && (
              <div className="runPanel">
                <div className="runHead">
                  <span className="runBadge">{runStatus === "running" ? "AGENTS RUNNING" : "DEMO COMPLETE"}</span>
                  <span className="runId">{run.runId} · {run.mode} mode</span>
                </div>
                <div className="runGrid">
                  <div className="runCard"><span className="runTag">PROCUREMENT 03</span><b className="mono">{run.procurement.poisonedMemoryId}</b><small>poisoned memory formed</small><small>influenced: {run.procurement.decisionMemoryIds.length} memory(s)</small></div>
                  <div className="runCard"><span className="runTag">FINANCE 07</span><b>${run.finance.payload?.amount?.toLocaleString() ?? "—"}</b><small>{run.finance.retrievals.length} retrievals logged</small><small>{run.finance.payload?.simulated ? "simulated · never executed" : "external action"}</small></div>
                  <div className="runCard"><span className="runTag">OPERATIONS 04</span><b className="mono">{run.operations.derivedMemoryId}</b><small>derived trust memory</small><small>influenced: {run.operations.decisionMemoryIds.length} memory(s)</small></div>
                  <div className="runCard"><span className="runTag">SECURITY 09</span><b className={run.security.verdict === "suspect" ? "danger" : ""}>{run.security.verdict.toUpperCase()}</b><small>{run.security.blastRadius.decisionIds.length} decisions in blast radius</small><small>{run.security.repair?.executed ? "transactional repair executed" : "verdict only"}</small></div>
                </div>
              </div>
            )}
          </section>

          <section className="proof" aria-label="ANTIDOTE recovery protocol">
            <article><span>TRACE</span><h3>Capture the influence.</h3><p>Every retrieval, decision, derived memory, and action records the exact memory inputs that influenced it.</p></article>
            <article><span>REPAIR</span><h3>Change state as one.</h3><p>Transactional recovery changes the root memory and every affected descendant in one governed operation.</p></article>
            <article><span>IMMUNIZE</span><h3>Recognize the repeat.</h3><p>The confirmed attack becomes security memory, allowing future candidates to be screened before trust.</p></article>
          </section>
        </div>
      )}

      {view === "attacks" && (
        <div id="view-attacks" role="tabpanel" aria-labelledby="tab-attacks">
          <AttacksView />
        </div>
      )}
      {view === "audit" && (
        <div id="view-audit" role="tabpanel" aria-labelledby="tab-audit">
          <AuditView />
        </div>
      )}
      {view === "trace" && (
        <div id="view-trace" role="tabpanel" aria-labelledby="tab-trace">
          <TraceView memoryIdHint={rootNode?.id ?? run?.procurement.poisonedMemoryId} />
        </div>
      )}
      <footer className="appFooter" aria-labelledby="footer-title">
        <div className="footerCausal" aria-hidden="true">
          <svg viewBox="0 0 1440 230" preserveAspectRatio="none">
            <path className="footerPathBase" d="M0 164 C180 164 240 92 410 92 S570 138 690 116" />
            <path className="footerPathBase" d="M750 116 C910 116 950 58 1110 58 S1260 92 1440 38" />
            <path className="footerThreatFlow" pathLength="1" d="M0 164 C180 164 240 92 410 92 S570 138 690 116" />
            <path className="footerRecoveryFlow" pathLength="1" d="M750 116 C910 116 950 58 1110 58 S1260 92 1440 38" />
            <circle className="footerThreatNode" cx="183" cy="151" r="5" />
            <circle className="footerThreatNode" cx="410" cy="92" r="5" />
            <circle className="footerRecoveryNode" cx="1110" cy="58" r="5" />
            <circle className="footerRecoveryNode" cx="1320" cy="69" r="5" />
            <g className="footerGate" transform="translate(720 116)">
              <rect x="-27" y="-27" width="54" height="54" />
              <rect x="-13" y="-13" width="26" height="26" />
              <path d="M-6 0 L-1 6 L8 -8" />
            </g>
          </svg>
          <div className="footerCausalLabels">
            <span>COMPROMISED MEMORY</span>
            <span>GOVERNED REPAIR</span>
            <span>TRUSTED RE-EVALUATION</span>
          </div>
        </div>

        <div className="footerClosure">
          <div className="footerStatement">
            <h2 id="footer-title"><span>MEMORY ENDS.</span><span>INFLUENCE DOESN&apos;T.</span></h2>
          </div>
          <div className="footerThesis">
            <p>ANTIDOTE traces every consequence of compromised AI memory, previews the full blast radius, and repairs affected state without erasing the evidence.</p>
            <button className="footerReturn" onClick={() => navigateFromFooter("graph")}>
              RETURN TO THE TRACE <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>

        <div className="footerLedger">
          <div className="footerIdentity">
            <Link className="footerBrand" href="/" aria-label="ANTIDOTE home">
              <span className="mark" aria-hidden="true"><i /></span>
              <span>ANTIDOTE</span>
            </Link>
            <p>Causal recovery for poisoned AI memory.</p>
          </div>

          <nav className="footerNav" aria-label="Footer navigation">
            {VIEWS.map((item) => (
              <button key={item.id} onClick={() => navigateFromFooter(item.id)} aria-current={view === item.id ? "page" : undefined}>
                <span>{item.numeral}</span>{item.label}
              </button>
            ))}
            <Link className="footerGuideLink" href="/docs" aria-label="Docs"><span>V</span>DOCS</Link>
            <Link className="footerGuideLink" href="/"><span>VI</span>HOW IT WORKS</Link>
          </nav>

          <dl className="footerRuntime">
            <div><dt>CASE</dt><dd>{run?.runId ?? "ZX-017"}</dd></div>
            <div><dt>ROOT</dt><dd>{rootNode?.label ?? "M-184"}</dd></div>
            <div><dt>STATE</dt><dd className={`footerPhase footerPhase-${phase}`}>{phase === "repaired" ? "CONTAINED" : phase === "simulated" ? "PREVIEW READY" : "ACTIVE RISK"}</dd></div>
            <div><dt>STORE</dt><dd>{scenarioState === "fallback" ? "OFFLINE SNAPSHOT" : "LIVE"}</dd></div>
          </dl>
        </div>

        <div className="footerLegal">
          <span>MEMORY RECOVERY PROTOCOL / 2026</span>
          <span>VIEW {tabIndex + 1} OF {VIEWS.length}</span>
          <span>TRACE · REPAIR · IMMUNIZE</span>
        </div>
        <div className="footerMonument" aria-hidden="true">ANTIDOTE</div>
      </footer>
    </main>
  );
}
