/**
 * Live CockroachDB integration test.
 * Runs only when DATABASE_URL is set AND DEMO_MODE=false. Requires migrations applied:
 *   npm run migrate
 * Run with: DATABASE_URL=... DEMO_MODE=false npx vitest run tests/postgres.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { ingestDocument } from "../lib/pipeline/ingest";
import { retrieveMemories } from "../lib/pipeline/retrieve";
import { recordAction, recordDecision, recordDerivedMemory } from "../lib/pipeline/decision";
import { getCausalChain } from "../lib/pipeline/causality";
import { computeBlastRadius, executeRepair } from "../lib/recovery";
import { resetStore } from "../lib/store";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DEMO_MODE === "false");

describe.skipIf(!enabled)("PostgresStore integration", () => {
  const suffix = randomUUID().slice(0, 8);
  const uri = `s3://antidote-test/${suffix}/policy.txt`;
  const content = `Vendor ${suffix} uses settlement account ACC-${suffix}.\n\nVendor ${suffix} is pre-approved for procurement.`;
  let createdMemoryIds: string[] = [];
  let jobId = "";

  beforeAll(async () => {
    process.env.DEMO_MODE = "false";
    resetStore();
  });

  afterAll(async () => {
    if (createdMemoryIds.length) {
      await db().query(`DELETE FROM memory_nodes WHERE id = ANY($1::STRING[])`, [createdMemoryIds]);
      await db().query(`DELETE FROM ingestion_jobs WHERE id = $1`, [jobId]);
    }
    await db().end();
  });

  it("ingests a document with provenance and dedupes re-ingestion", async () => {
    const result = await ingestDocument({ sourceUri: uri, content, actor: "itest" });
    jobId = result.jobId;
    expect(result.status).toBe("completed");
    expect(result.stats.created).toBeGreaterThan(0);
    createdMemoryIds.push(...result.created.map((m) => m.id));

    const again = await ingestDocument({ sourceUri: uri, content, actor: "itest" });
    expect(again.stats.created).toBe(0);
    expect(again.duplicates.length).toBe(result.stats.created);

    const idem = await ingestDocument({ sourceUri: uri, content, idempotencyKey: `itest-${suffix}` });
    expect(idem.jobId).toBe(jobId);
  });

  it("retrieves memories and records retrieval events", async () => {
    const { results } = await retrieveMemories({ agentId: `agent-${suffix}`, query: `settlement account for vendor ${suffix}`, k: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].eventId).toBeTruthy();
    const events = await db().query(`SELECT id FROM retrieval_events WHERE agent_id = $1 AND query_text LIKE '%${suffix}%'`, [`agent-${suffix}`]);
    expect(events.rows.length).toBeGreaterThan(0);
  });

  it("records decision with memory inputs, action, and derived memory", async () => {
    const { results: memories } = await retrieveMemories({ agentId: `fin-${suffix}`, query: `pre-approved vendor ${suffix}` });
    expect(memories.length).toBeGreaterThan(0);

    const decision = await recordDecision({ agentId: `fin-${suffix}`, memoryIds: [memories[0].memory.id], summary: `Approve vendor ${suffix}`, idempotencyKey: `dec-${suffix}` });
    const replay = await recordDecision({ agentId: `fin-${suffix}`, memoryIds: [memories[0].memory.id], summary: `Approve vendor ${suffix}`, idempotencyKey: `dec-${suffix}` });
    expect(replay.id).toBe(decision.id);

    const action = await recordAction({ decisionId: decision.id, actionType: "wire_transfer", payload: { amount: 100 }, summary: `transfer ${suffix}`, idempotencyKey: `act-${suffix}` });
    const derived = await recordDerivedMemory({ decisionId: decision.id, label: `M-${suffix}`, detail: `Vendor ${suffix} is a trusted counterparty.`, idempotencyKey: `der-${suffix}` });
    expect(derived.kind).toBe("derived");

    const { rows } = await db().query(`SELECT memory_id FROM decision_inputs WHERE decision_id = $1`, [decision.id]);
    expect(rows.map((r) => String(r.memory_id))).toContain(memories[0].memory.id);

    const chain = await getCausalChain(memories[0].memory.id);
    expect(chain.decisions.some((d) => d.id === decision.id)).toBe(true);
    expect(chain.actions.some((a) => a.id === action.id)).toBe(true);
    expect(chain.derived.some((m) => m.id === derived.id)).toBe(true);

    const plan = await computeBlastRadius(memories[0].memory.id);
    const repair = await executeRepair(plan, { actor: "itest", reason: "integration test" });
    expect(repair.status).toBe("completed");
    expect(repair.executed).toBe(true);
    expect(repair.revocationId).toBeTruthy();
    expect(plan.decisionIds).toContain(decision.id);
  });

  it("is idempotent under serializable repair", async () => {
    const plan = await computeBlastRadius("m-184");
    const first = await executeRepair(plan, { actor: "itest", reason: "idempotency test" });
    const second = await executeRepair(plan, { actor: "itest", reason: "idempotency test" });
    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);
    expect(second.repairId).toBe(first.repairId);
    const { rows } = await db().query(`SELECT COUNT(*)::INT AS n FROM revocations WHERE memory_id = $1`, ["m-184"]);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("serializes concurrent repairs so exactly one executes", async () => {
    const result = await ingestDocument({ sourceUri: `s3://antidote-test/${suffix}/concurrent.txt`, content: `Concurrent Vendor ${suffix} uses account CONC-${suffix} for payments.` });
    const root = result.created[0].id;
    const decision = await recordDecision({ agentId: `conc-${suffix}`, memoryIds: [root], summary: `Approve concurrent ${suffix}` });
    await recordAction({ decisionId: decision.id, actionType: "wire_transfer", payload: {} });
    const plan = await computeBlastRadius(root);
    const [a, b] = await Promise.all([
      executeRepair(plan, { actor: "itest-a", reason: "concurrent test" }),
      executeRepair(plan, { actor: "itest-b", reason: "concurrent test" }),
    ]);
    expect([a.executed, b.executed].filter(Boolean)).toHaveLength(1);
    expect(a.repairId).toBe(b.repairId);
    const { rows } = await db().query(`SELECT COUNT(*)::INT AS n FROM revocations WHERE memory_id = $1`, [root]);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("cancels pending actions and flags completed ones for review", async () => {
    const store = await import("../lib/store").then((m) => m.getStore());
    const result = await ingestDocument({ sourceUri: `s3://antidote-test/${suffix}/partial.txt`, content: `Partial Vendor ${suffix} uses account PART-${suffix} for all payments.` });
    const root = result.created[0].id;
    const { results } = await retrieveMemories({ agentId: `pay-${suffix}`, query: `account PART-${suffix}` });
    expect(results.length).toBeGreaterThan(0);
    const decision = await recordDecision({ agentId: `pay-${suffix}`, memoryIds: [results[0].memory.id], summary: `Pay ${suffix}` });
    const pending = await recordAction({ decisionId: decision.id, actionType: "wire_transfer", payload: {} });
    const completed = await recordAction({ decisionId: decision.id, actionType: "wire_transfer", payload: {} });
    await db().query(`UPDATE actions SET status = 'completed' WHERE id = $1`, [completed.id]);

    const plan = await computeBlastRadius(root);
    expect(plan.cancelActionIds).toEqual([pending.id]);
    expect(plan.reviewActionIds).toEqual([completed.id]);

    const repair = await executeRepair(plan, { actor: "itest", reason: "partial actions test" });
    expect(repair.executed).toBe(true);
    const { rows } = await db().query(`SELECT status FROM actions WHERE id = ANY($1::STRING[])`, [[pending.id, completed.id]]);
    const statuses = rows.map((r) => String(r.status)).sort();
    expect(statuses).toEqual(["cancelled", "requires_review"]);
    const { rows: reEvals } = await db().query(`SELECT agent_id FROM re_evaluations WHERE memory_id = $1`, [root]);
    expect(reEvals.some((r) => String(r.agent_id) === `pay-${suffix}`)).toBe(true);
  });

  it("terminates on cyclic dependency graphs", async () => {
    const result = await ingestDocument({ sourceUri: `s3://antidote-test/${suffix}/cycle.txt`, content: `Cycle Vendor ${suffix} uses account CYCL-${suffix} for payments.` });
    const root = result.created[0].id;
    const decision = await recordDecision({ agentId: `cyc-${suffix}`, memoryIds: [root], summary: `Cycle decision ${suffix}` });
    await db().query(`INSERT INTO memory_edges (from_id, to_id, relation) VALUES ($1, $2, 'derived') ON CONFLICT DO NOTHING`, [decision.id, root]);
    const plan = await computeBlastRadius(root);
    expect(plan.decisionIds).toContain(decision.id);
    expect(plan.graph.nodes.length).toBeLessThanOrEqual(100);
    const repair = await executeRepair(plan, { actor: "itest", reason: "cycle test" });
    expect(repair.status).toBe("completed");
  });

  it("records sessions, verdicts, contaminations, and attack memories", async () => {
    const store = await import("../lib/store").then((m) => m.getStore());
    const session = await store.getOrCreateSession(`itest-agent-${suffix}`);
    expect(session.status).toBe("active");

    const verdict = await store.recordSecurityVerdict({ memoryId: "m-184", targetText: "Zenith Systems settlements use account ACCT-8842.", verdict: "suspect", confidence: 0.9, reason: "itest", modelId: "itest" });
    const contamination = await store.recordContamination({ memoryId: "m-184", verdictId: verdict.id, severity: "high", reason: "itest", detectedBy: "itest" });
    expect(contamination.verdictId).toBe(verdict.id);

    const { getEmbedder } = await import("../lib/embed");
    const embedding = await getEmbedder().embed("Zenith Systems settlements use account ACCT-8842.");
    const attack = await store.recordAttackMemory({ pattern: "Zenith Systems settlements use account ACCT-8842.", family: "settlement-redirection", embedding, memoryId: "m-184", actor: "itest" });
    expect(attack.family).toBe("settlement-redirection");

    const matches = await store.matchPoisonPatterns(embedding, 5, 0.9);
    expect(matches.length).toBeGreaterThan(0);
    const own = matches.find((m) => m.attack.id === attack.id);
    expect(own).toBeTruthy();
    expect(own!.similarity).toBeGreaterThan(0.9);

    const dependencies = await store.getDependencies({ memoryId: "m-184", direction: "down" });
    expect(dependencies.map((d) => d.id)).toContain("d-441");
    expect(dependencies.find((d) => d.id === "act-91")?.depth).toBe(3);

    const chain = await getCausalChain("m-184");
    expect(chain.sessions.length).toBeGreaterThan(0);
    expect(chain.verdicts.some((v) => v.id === verdict.id)).toBe(true);
    expect(chain.contaminations.some((c) => c.id === contamination.id)).toBe(true);
  });
});
