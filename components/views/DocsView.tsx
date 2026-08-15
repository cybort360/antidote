const PROTOCOL = [
  { step: "01", title: "Security verdict marks a memory suspect", detail: "OpenCode Go, Bedrock, or an operator classifies the memory; the verdict and confidence are recorded immutably." },
  { step: "02", title: "Recursive graph traversal computes descendants", detail: "A cycle-safe recursive closure walks retrieved / influenced / produced / derived edges from the root." },
  { step: "03", title: "Simulation previews affected artifacts", detail: "The dry run returns exactly what will be revoked, quarantined, invalidated, cancelled, or flagged for review before any state changes." },
  { step: "04", title: "A transaction revokes and quarantines", detail: "SERIALIZABLE isolation + a row lock on the root; no agent ever observes a half-repaired graph." },
  { step: "05", title: "External actions are cancelled or escalated", detail: "Pending actions cancel; completed/executing actions become requires_review for human remediation." },
  { step: "06", title: "Affected agents re-evaluate from clean memory", detail: "The worker starts fresh sessions and records replacement decisions or refusals with execution evidence." },
];

const STATUSES = [
  ["ACTIVE", "trusted", "the normal live state of a memory or agent artifact"],
  ["SUSPECT", "suspect", "flagged by a security verdict; excluded from trust flows"],
  ["QUARANTINED", "quarantined", "dependent memories isolated by a repair; not retrievable"],
  ["REVOKED", "revoked", "the root memory's influence has been severed"],
  ["INVALIDATED", "invalidated", "decisions whose inputs were revoked"],
  ["CANCELLED", "cancelled", "pending external actions stopped by a repair"],
  ["REPAIRED", "repaired", "terminal marker: influence repaired, history preserved"],
  ["REQUIRES_REVIEW", "requires_review", "irreversible actions needing human remediation"],
];

export function DocsView() {
  return (
    <section className="view docs">
      <header className="viewHead">
        <div>
          <p className="eyebrow">FIELD MANUAL / 0.1</p>
          <h2>Memory is state. Influence is state too.</h2>
          <p className="lede">ANTIDOTE is an agent-memory recovery runtime for autonomous systems. It makes memory influence observable, reversible, and auditable.</p>
        </div>
      </header>

      <div className="docGrid">
        <article className="docCard">
          <span className="docIndex">I</span>
          <h3>Core invariant</h3>
          <blockquote>Revoking a memory must revoke its influence.</blockquote>
          <p>Deleting a compromised vector does not undo decisions already made from it. ANTIDOTE records causal lineage at decision time, so downstream state can be recomputed and repaired transactionally.</p>
        </article>

        <article className="docCard">
          <span className="docIndex">II</span>
          <h3>Data model</h3>
          <pre>{`source → memory → retrieval → decision → action → derived memory
                      ↘ provenance + trust + temporal state`}</pre>
          <p>One CockroachDB system holds structured lineage, transactional recovery state, semantic embeddings, attack intelligence, and the audit ledger.</p>
        </article>

        <article className="docCard">
          <span className="docIndex">III</span>
          <h3>Recovery protocol</h3>
          <ol className="protocolList">
            {PROTOCOL.map((item) => (
              <li key={item.step}>
                <b>
                  {item.step} · {item.title}
                </b>
                <span>{item.detail}</span>
              </li>
            ))}
          </ol>
        </article>

        <article className="docCard">
          <span className="docIndex">IV</span>
          <h3>Status vocabulary</h3>
          <table className="statusTable">
            <thead>
              <tr>
                <th>STATUS</th>
                <th>MEANING</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map(([name, key, meaning]) => (
                <tr key={key}>
                  <td>
                    <span className={`badge badge-status ${key}`}>{name}</span>
                  </td>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="docCard">
          <span className="docIndex">V</span>
          <h3>Second learning loop</h3>
          <p>Confirmed poisoning incidents become trusted attack memories: family, source characteristics, semantic embedding, affected entities, method, verdict, repair outcome, provenance.</p>
          <p>Every candidate memory is screened before trust using semantic vector search plus structural entity, source, and method evidence. Candidates at or above the risk threshold are quarantined.</p>
        </article>

        <article className="docCard">
          <span className="docIndex">VI</span>
          <h3>Sponsor stack</h3>
          <ul className="docList">
            <li><b>CockroachDB:</b> system of record, distributed transactions, VECTOR search, recursive CTEs, and inverted indexes.</li>
            <li><b>CockroachDB Cloud MCP:</b> governed read-only access for the Security/Forensics agent through a SELECT-scoped role.</li>
            <li><b>Amazon Bedrock:</b> agent reasoning, structured decisions, extraction, embeddings, and verdicts.</li>
            <li><b>OpenCode Go:</b> OpenAI-compatible structured reasoning, extraction, and security verdicts.</li>
            <li><b>AWS Lambda:</b> asynchronous repair and re-evaluation jobs with idempotent execution.</li>
            <li><b>AWS S3 Object Lock:</b> immutable source and evidence archive.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
