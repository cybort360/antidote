"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const QUICKSTART = `npm run setup
npm run dev

# open http://localhost:3000`;

const AGENT_INTEGRATION = `const baseUrl = process.env.ANTIDOTE_URL ?? "http://localhost:3000";
const apiKey = process.env.ANTIDOTE_API_KEY;

async function antidote<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(\`\${baseUrl}\${path}\`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: \`Bearer \${apiKey}\` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(\`ANTIDOTE request failed: \${response.status}\`);
  }

  return response.json() as Promise<T>;
}

const ingested = await antidote<{
  memories: Array<{ id: string }>;
}>("/api/ingest", {
  sourceUri: "urn:agent:policy:payments-v3",
  content: "Payments above $10,000 need two approvers.",
  actor: "policy-sync",
  idempotencyKey: "payments-policy-v3",
});

const recalled = await antidote<{
  results: Array<{ memory: { id: string }; eventId: string }>;
}>("/api/retrieve", {
  agentId: "finance-agent-07",
  query: "What approval is required for a $24,000 payment?",
  k: 5,
  context: { runId: "run-2026-08-12-001" },
});

const memoryIds = recalled.results.map((result) => result.memory.id);
if (memoryIds.length === 0) throw new Error("No trusted memory returned");

const decision = await antidote<{ id: string }>("/api/decisions", {
  agentId: "finance-agent-07",
  memoryIds,
  summary: "Request a second approver before payment",
  idempotencyKey: "decision-payment-24000-v1",
});

const action = await antidote<{ id: string; status: string }>(
  \`/api/decisions/\${decision.id}/actions\`,
  {
    actionType: "approval.requested",
    payload: { amount: 24000, currency: "USD" },
    summary: "Second approval requested",
    externalRef: "approval-queue/REQ-184",
    idempotencyKey: "action-payment-24000-v1",
  },
);

console.log({ ingested: ingested.memories.length, decision, action });`;

const RECOVERY = `const preview = await antidote<{
  mode: "simulation";
  affected: {
    memories: number;
    decisions: number;
    actions: number;
    agents: number;
  };
}>("/api/revocations", {
  memoryId: "mem_184",
  execute: false,
  reason: "Source failed verification",
  actor: "security-agent-09",
});

console.table(preview.affected);

// Put operator approval or policy approval here.
const repair = await antidote("/api/revocations", {
  memoryId: "mem_184",
  execute: true,
  reason: "Source failed verification",
  actor: "security-agent-09",
});`;

const LIVE_ENV = `DEMO_MODE=false
DATABASE_URL=postgresql://user:password@host:26257/defaultdb?sslmode=verify-full
ANTIDOTE_TENANT_ID=tenant-acme
ANTIDOTE_API_KEYS=[{"keyHash":"sha256-hex","tenantId":"tenant-acme","principal":"agent-prod","role":"writer"}]

OPENCODE_GO_API_KEY=
OPENCODE_GO_MODEL=deepseek-v4-flash

EVIDENCE_BUCKET=
COCKROACH_MCP_URL=
COCKROACH_MCP_API_KEY=`;

const DATABASE_SETUP = `npm run migrate
cockroach sql --url "$DATABASE_URL" -f db/roles.sql

# optional demo records
cockroach sql --url "$DATABASE_URL" -f db/seed.sql`;

const VERIFY = `npm run check
npm run smoke
npm run verify:release

# full live proof
ANTIDOTE_URL="https://your-host" npm run verify:live`;

type CodePanelProps = {
  label: string;
  code: string;
  language?: string;
};

function CodePanel({ label, code, language = "SHELL" }: CodePanelProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="howCodePanel">
      <div className="howCodeHead">
        <span>{label}</span>
        <div>
          <small>{language}</small>
          <button type="button" onClick={copy} aria-label={`Copy ${label} code`}>
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>
      </div>
      <pre tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}

const STORY_WORDS = "Agents do not act from prompts alone. They act from remembered claims. When one claim fails, deleting one row does not repair the decisions, derived memories, or external actions it already shaped. ANTIDOTE records the influence before the incident, then repairs the whole chain after it.".split(" ");

function StoryReveal() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setProgress(1);
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const travel = rect.height + window.innerHeight * 0.35;
      const next = Math.min(1, Math.max(0, (window.innerHeight * 0.78 - rect.top) / travel));
      setProgress(next);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const lit = Math.ceil(progress * STORY_WORDS.length);
  return (
    <section className="assayStory stackCard" ref={sectionRef} aria-label="Why causal memory recovery matters">
      <p>{STORY_WORDS.map((word, index) => <span className={index < lit ? "isLit" : ""} key={`${word}-${index}`}>{word} </span>)}</p>
    </section>
  );
}

const FLOW_STEPS = [
  { number: "01", name: "INGEST", text: "Turn a source into screened, hashed memory with provenance." },
  { number: "02", name: "RETRIEVE", text: "Return trusted memories and record one retrieval event per hit." },
  { number: "03", name: "DECIDE", text: "Store the exact memory IDs which influenced the decision." },
  { number: "04", name: "ACT", text: "Attach an intended external action to its parent decision." },
  { number: "05", name: "RECOVER", text: "Preview the blast radius, then repair related state in one transaction." },
] as const;

const ENDPOINTS = [
  ["POST", "/api/ingest", "Screen and store source memory"],
  ["POST", "/api/retrieve", "Recall memory and log retrievals"],
  ["POST", "/api/decisions", "Record memory inputs"],
  ["POST", "/api/decisions/:id/actions", "Record an intended side effect"],
  ["POST", "/api/decisions/:id/derived", "Record derived memory"],
  ["GET", "/api/lineage?memoryId=…", "Read the causal chain"],
  ["POST", "/api/revocations", "Simulate or execute recovery"],
  ["GET", "/api/dependencies", "Walk the dependency graph"],
] as const;

export default function HowItWorksPage() {
  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".xirpFlow .stackCard"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (cards.length === 0 || reduced.matches) return;

    let frame = 0;
    let needsMeasure = true;
    let stickyTop = 104;

    const measure = () => {
      stickyTop = window.innerWidth <= 820 ? 86 : 104;
      const viewportBottomInset = window.innerWidth <= 820 ? 10 : 16;

      cards.forEach((card) => {
        const top = Math.min(stickyTop, window.innerHeight - card.offsetHeight - viewportBottomInset);
        card.style.setProperty("--stack-top", `${top}px`);
      });
      needsMeasure = false;
    };

    const update = () => {
      frame = 0;
      if (needsMeasure) measure();
      const approach = Math.min(window.innerHeight * 0.36, 320);

      cards.forEach((card, index) => {
        const next = cards[index + 1];
        const nextRect = next?.getBoundingClientRect();
        const progress = next
          ? Math.min(1, Math.max(0, (stickyTop + approach - nextRect!.top) / approach))
          : 0;
        const retired = Boolean(nextRect && nextRect.bottom <= window.innerHeight + 1);
        card.style.setProperty("--stack-scale", (1 - progress * 0.018).toFixed(4));
        card.style.setProperty("--stack-shadow", (0.11 + progress * 0.08).toFixed(3));
        card.style.setProperty("--stack-opacity", retired ? "0" : "1");
        card.style.setProperty("--stack-visibility", retired ? "hidden" : "visible");
        card.style.zIndex = retired ? "0" : String(10 + index);
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const remeasure = () => {
      needsMeasure = true;
      schedule();
    };

    update();
    const cardObserver = new ResizeObserver(remeasure);
    cards.forEach((card) => cardObserver.observe(card));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    return () => {
      cardObserver.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      if (frame) window.cancelAnimationFrame(frame);
      cards.forEach((card) => {
        card.style.removeProperty("--stack-top");
        card.style.removeProperty("--stack-scale");
        card.style.removeProperty("--stack-shadow");
        card.style.removeProperty("--stack-opacity");
        card.style.removeProperty("--stack-visibility");
        card.style.removeProperty("z-index");
      });
    };
  }, []);

  return (
    <main className="howShell xirpFlow">
      <header className="howTopbar">
        <Link className="howBrand" href="/" aria-label="ANTIDOTE home">
          <span className="mark" aria-hidden="true"><i /></span>
          <span>ANTIDOTE</span>
        </Link>
        <nav aria-label="Developer guide sections">
          <a href="#mechanism">MECHANISM</a>
          <a href="#quickstart">INSTALL</a>
          <a href="#integrate">API</a>
        </nav>
        <Link className="howLiveCaseLink" href="/case"><span /> OPEN LIVE CASE</Link>
      </header>

      <section className="howHero" aria-labelledby="how-title">
        <div className="howHeroCopy">
          <h1 id="how-title"><span>MEMORY</span><span>SHAPES</span><span>EVERYTHING.</span></h1>
          <p>ANTIDOTE records what your agent remembered, what it decided, and what happened next. When trust fails, you repair the influence chain instead of hiding the evidence.</p>
          <div className="howHeroActions">
            <a className="howPrimary" href="#quickstart">INSTALL LOCALLY</a>
            <a className="howTextLink" href="#mechanism">SEE THE CHAIN <span aria-hidden="true">↓</span></a>
          </div>
        </div>
      </section>

      <section className="assayProduct stackCard" id="mechanism" aria-labelledby="product-proof-title">
        <div className="assayProductHead">
          <h2 id="product-proof-title">See the damage<br />as a system.</h2>
          <div><p>The live case turns one poisoned claim into an inspectable causal map. Every node exists because the runtime recorded an influence.</p><Link href="/case">EXPLORE THE LIVE CASE</Link></div>
        </div>
      </section>

      <StoryReveal />

      <section className="howSection howArchitecture stackCard" id="architecture" aria-labelledby="architecture-title">
        <div className="howSectionHead">
          <span>THE RECORD</span>
          <h2 id="architecture-title">Five calls create one recoverable chain.</h2>
          <p>Route memory operations through five API steps. The agent continues to reason and act through its current framework.</p>
        </div>
        <div className="howFlow" aria-label="Five step causal lifecycle">
          {FLOW_STEPS.map((step, index) => (
            <article key={step.name}>
              <div className="howFlowIndex"><span>{step.number}</span>{index < FLOW_STEPS.length - 1 && <i aria-hidden="true" />}</div>
              <h3>{step.name}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
        <div className="howArchitectureNote">
          <span>DESIGN RULE</span>
          <p>If an action matters, record its parent decision. If a decision matters, record the memory IDs which shaped it. This creates the graph ANTIDOTE repairs.</p>
        </div>
      </section>

      <section className="howSection howQuickstart stackCard" id="quickstart" aria-labelledby="quickstart-title">
        <div className="howSectionHead howSectionHeadCompact">
          <span>START HERE</span>
          <h2 id="quickstart-title">Two commands. Full incident.</h2>
          <p>Start from this repository with Node.js 22 or newer. Demo mode needs no database, cloud account, or model credentials.</p>
        </div>
        <div className="howInstallGrid">
          <CodePanel label="LOCAL QUICKSTART" code={QUICKSTART} />
          <ol className="howInstallChecks">
            <li><span>01</span><div><b>SETUP</b><p>Copies the environment template, installs dependencies, and applies migrations when a database URL exists.</p></div></li>
            <li><span>02</span><div><b>RUN</b><p>Starts the Next.js application and its API routes on localhost.</p></div></li>
            <li><span>03</span><div><b>PROVE</b><p>Open the case map, run the autonomous demo, simulate revocation, then execute repair.</p></div></li>
          </ol>
        </div>
        <div className="howModeCompare">
          <article><span>DEFAULT</span><h3>DEMO MODE</h3><p>In-memory system of record, seeded incident, deterministic extraction and embeddings, no credentials.</p><code>DEMO_MODE=true</code></article>
          <article><span>PERSISTENT</span><h3>LIVE MODE</h3><p>CockroachDB system of record with tenant-scoped API keys, OpenCode Go or Bedrock reasoning, S3 evidence, and read-only forensic MCP.</p><code>DEMO_MODE=false</code></article>
        </div>
      </section>

      <section className="howSection howIntegrate stackCard" id="integrate" aria-labelledby="integrate-title">
        <div className="howSectionHead">
          <span>THE API</span>
          <h2 id="integrate-title">Wrap the moments where memory changes behavior.</h2>
          <p>The repository exposes REST endpoints, an OpenAPI contract, and a buildable TypeScript SDK. Use them from a server-side agent runtime.</p>
        </div>
        <div className="howIntegrationLayout">
          <aside className="howIntegrationRules">
            <div><span>BEFORE REASONING</span><b>Retrieve through ANTIDOTE</b><p>Each returned memory includes its memory ID and retrieval event ID.</p></div>
            <div><span>AFTER REASONING</span><b>Record the decision</b><p>Pass every memory ID used by the model, not the full search result.</p></div>
            <div><span>BEFORE A SIDE EFFECT</span><b>Record the intended action</b><p>Attach the action to the decision and give retries one idempotency key.</p></div>
            <div><span>WHEN TRUST FAILS</span><b>Simulate before execute</b><p>Review affected memories, decisions, actions, and agents before repair.</p></div>
          </aside>
          <CodePanel label="NODE 22 / TYPESCRIPT" language="TYPESCRIPT" code={AGENT_INTEGRATION} />
        </div>

        <div className="howEndpointTable" aria-label="Core REST endpoints">
          <div className="howEndpointHead"><span>METHOD</span><span>PATH</span><span>PURPOSE</span></div>
          {ENDPOINTS.map(([method, path, purpose]) => (
            <div key={path}><span className={`howMethod howMethod${method}`}>{method}</span><code>{path}</code><p>{purpose}</p></div>
          ))}
        </div>
      </section>

      <section className="howSection howRecovery stackCard" id="recovery" aria-labelledby="recovery-title">
        <div className="howSectionHead howSectionHeadCompact">
          <span>THE ANTIDOTE</span>
          <h2 id="recovery-title">Preview first. Repair second.</h2>
          <p>The first call computes the blast radius without mutation. The second call runs recovery against the same causal graph.</p>
        </div>
        <div className="howRecoveryGrid">
          <CodePanel label="SIMULATE, REVIEW, EXECUTE" language="TYPESCRIPT" code={RECOVERY} />
          <div className="howRepairPlan">
            <div><span>MEMORY</span><p>Revoke the compromised root. Quarantine derived descendants.</p></div>
            <div><span>DECISIONS</span><p>Invalidate decisions whose recorded inputs include affected memory.</p></div>
            <div><span>ACTIONS</span><p>Cancel pending actions. Flag irreversible actions for operator review.</p></div>
            <div><span>AGENTS</span><p>Queue affected agent cases for clean-memory re-evaluation.</p></div>
            <small>The worker starts a fresh agent session, retrieves only trusted memory, then records a replacement decision or an explicit refusal with full execution evidence.</small>
          </div>
        </div>
      </section>

      <section className="howSection howProduction stackCard" id="production" aria-labelledby="production-title">
        <div className="howSectionHead">
          <span>GO LIVE</span>
          <h2 id="production-title">Replace the demo store with governed infrastructure.</h2>
          <p>Start with CockroachDB. Add model and evidence services after database persistence passes its live integration suite.</p>
        </div>
        <div className="howProductionGrid">
          <article>
            <div className="howProductionTitle"><span>01</span><h3>COCKROACHDB</h3><b>REQUIRED</b></div>
            <p>Stores memory nodes, causal edges, retrievals, decisions, actions, audits, attack memory, and repair state.</p>
            <CodePanel label="MIGRATE AND SCOPE ROLES" code={DATABASE_SETUP} />
          </article>
          <article>
            <div className="howProductionTitle"><span>02</span><h3>REASONING + EVIDENCE</h3><b>REQUIRED / OPTIONAL</b></div>
            <p>OpenCode Go or Bedrock provides model-backed extraction and verdicts. S3 stores immutable source and repair evidence.</p>
            <CodePanel label="ENVIRONMENT" code={LIVE_ENV} />
          </article>
        </div>
        <div className="howInfraRail">
          <div><span>COCKROACHDB</span><b>CODE PRESENT</b><p>Live cluster proof required per deployment.</p></div>
          <div><span>OPENCODE GO / BEDROCK</span><b>CODE PRESENT</b><p>One reasoning provider and credentials required.</p></div>
          <div><span>LAMBDA + S3</span><b>CODE PRESENT</b><p>SAM deployment proof required.</p></div>
          <div><span>MANAGED MCP</span><b>FORENSIC ONLY</b><p>Read-only database access for Security and Forensics agents.</p></div>
        </div>
      </section>

      <section className="howSection howVerify stackCard" id="verify" aria-labelledby="verify-title">
        <div className="howVerifyCopy">
          <span>PROVE IT</span>
          <h2 id="verify-title">Do not infer live readiness from a green demo.</h2>
          <p>The release matrix proves the local request flow. Production proof also needs live CockroachDB, API authentication, model-backed reasoning, and clean-memory worker execution.</p>
          <div className="howVerifiedStamp"><strong>16 / 16</strong><span>LOCAL RELEASE CHECKS<br />LAST VERIFIED IN DEMO MODE</span></div>
        </div>
        <CodePanel label="VERIFICATION GATES" code={VERIFY} />
      </section>

      <section className="howBoundary stackCard" aria-labelledby="boundary-title">
        <div><span>PUBLIC DEPLOYMENT BOUNDARY</span><h2 id="boundary-title">Deploy one tenant per isolated database boundary.</h2></div>
        <p>Live routes require tenant-scoped bearer keys and role checks. Keep raw keys in a server-side secret manager. Do not send them to untrusted browser code.</p>
      </section>

      <footer className="howFooter stackCard stackCardFinal">
        <div className="howFooterSignal" aria-hidden="true">
          <span />
          <svg viewBox="0 0 1200 150" preserveAspectRatio="none"><path pathLength="1" d="M0 104 C240 104 270 34 480 34 S720 118 884 76 S1064 28 1200 28" /></svg>
          <span />
        </div>
        <div className="howFooterMain">
          <div><span>THE CHAIN IS WAITING.</span><h2>RUN THE INCIDENT.<br />PROVE THE REPAIR.</h2></div>
          <div><p>Use the live case to inspect the graph your integration needs to create.</p><Link className="howPrimary" href="/case">OPEN THE LIVE CASE</Link></div>
        </div>
        <div className="howFooterRail">
          <Link className="howBrand" href="/"><span className="mark" aria-hidden="true"><i /></span><span>ANTIDOTE</span></Link>
          <nav aria-label="Guide footer navigation"><a href="#quickstart">INSTALL</a><a href="#integrate">API</a><a href="#production">PRODUCTION</a><a href="#verify">VERIFY</a><Link href="/docs" aria-label="Docs">DOCS</Link></nav>
          <span>CAUSAL MEMORY RECOVERY / 2026</span>
        </div>
        <div className="howFooterMonument" aria-hidden="true">ANTIDOTE</div>
      </footer>
    </main>
  );
}
