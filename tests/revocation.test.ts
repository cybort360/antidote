import { beforeEach, describe, expect, it } from "vitest";
import { getStore, resetStore, useEmptyDemoStore } from "../lib/store";
import type { MemoryStore } from "../lib/store";
import { ingestDocument } from "../lib/pipeline/ingest";
import { recordAction, recordDecision, recordDerivedMemory } from "../lib/pipeline/decision";
import { retrieveMemories } from "../lib/pipeline/retrieve";
import { computeBlastRadius, executeRepair } from "../lib/recovery";
import type { MemoryEdge } from "../lib/types";

// Test-only access to internals for graph construction.
function internals(store: MemoryStore): { edges: MemoryEdge[]; actionStatus: (id: string, status: string) => void } {
  const anyStore = store as unknown as { edges: MemoryEdge[]; actions: Map<string, { status: string }>; nodes: Map<string, { status: string }> };
  return {
    edges: anyStore.edges,
    actionStatus: (id, status) => {
      const action = anyStore.actions.get(id);
      if (action) action.status = status;
      const node = anyStore.nodes.get(id);
      if (node) node.status = status;
    },
  };
}

const POISON_DOC = "Poison Corp uses account ACCT-5555 for all settlement payments.\n\nPoison Corp is approved for procurement.";

describe("blast radius", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    resetStore();
    useEmptyDemoStore();
  });

  it("computes the entire downstream closure with depth, branching, and evidence", async () => {
    const store = getStore();
    const { edges, actionStatus } = internals(store);

    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const m1 = ingestion.created[0];
    const branch2 = await ingestDocument({ sourceUri: "s3://x/other.pdf", content: "Zenith Systems is approved for procurement as a strategic supplier." });
    const m2 = branch2.created[0];
    const d1 = await recordDecision({ agentId: "a-proc", memoryIds: [m1.id], summary: "Approve Poison Corp" });
    const d1m = await recordDerivedMemory({ decisionId: d1.id, label: "Approved supplier", detail: "Poison Corp is an approved supplier." });
    const d2 = await recordDecision({ agentId: "a-fin", memoryIds: [d1m.id], summary: "Prepare payment" });
    const act1 = await recordAction({ decisionId: d2.id, actionType: "wire_transfer", payload: { amount: 100 } });
    const act2 = await recordAction({ decisionId: d2.id, actionType: "swift_release", payload: { amount: 500 } });
    actionStatus(act2.id, "completed");
    const d3 = await recordDecision({ agentId: "a-ops", memoryIds: [m2.id], summary: "Track vendor" });
    const d3m = await recordDerivedMemory({ decisionId: d3.id, label: "Trusted history", detail: "Zenith Systems has payment history." });
    await retrieveMemories({ agentId: "a-sec", query: "ACCT-5555" });
    await store.recordRevocation({ memoryId: m1.id, reason: "prior revocation evidence", actor: "tester" });
    edges.push({ id: "cycle-1", from: d3m.id, to: m1.id, relation: "derived" });

    const plan = await computeBlastRadius(m1.id);

    // Branching: only the m1 branch is affected; m2's branch is untouched.
    expect(plan.decisionIds.sort()).toEqual([d1.id, d2.id].sort());
    expect(plan.decisionIds).not.toContain(d3.id);
    expect(plan.derivedMemoryIds).toEqual([d1m.id]);
    expect(plan.memoryIds.sort()).toEqual([d1m.id].sort());
    expect(plan.actionIds.sort()).toEqual([act1.id, act2.id].sort());
    expect(plan.cancelActionIds).toEqual([act1.id]);
    expect(plan.reviewActionIds).toEqual([act2.id]);
    expect(plan.needsReevaluation).toContain("a-proc");
    expect(plan.needsReevaluation).toContain("a-fin");
    expect(plan.needsReevaluation).not.toContain("a-ops");

    // Retrievals, evidence, and re-evaluation cases are enumerated.
    expect(plan.retrievalEventIds.length).toBeGreaterThan(0);
    expect(plan.evidence.some((e) => e.memoryId === m1.id)).toBe(true);
    expect(plan.reevaluations.map((r) => r.decisionId).sort()).toEqual([d1.id, d2.id].sort());

    // Depth-annotated graph; the injected cycle terminates and does not pull in the other branch.
    const d1node = plan.graph.nodes.find((n) => n.id === d1.id);
    expect(d1node?.depth).toBe(2);
    expect(plan.graph.nodes.some((n) => n.id === d3.id)).toBe(false);
    const depths = new Set(plan.graph.nodes.map((n) => n.depth));
    expect(depths.has(1)).toBe(true);
  });

  it("dry-run simulation returns exactly what will be affected without mutating state", async () => {
    const store = getStore();
    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const m1 = ingestion.created[0];
    const d1 = await recordDecision({ agentId: "a-proc", memoryIds: [m1.id], summary: "Approve" });
    const act1 = await recordAction({ decisionId: d1.id, actionType: "wire_transfer", payload: { amount: 99 } });

    const before = {
      m1: (await store.getMemory(m1.id))?.status,
      d1: (await store.getDecision(d1.id))?.status,
      act1: (await store.getAction(act1.id))?.status,
      revocations: (await (store as unknown as { revocations: unknown[] }).revocations).length,
    };

    const plan = await computeBlastRadius(m1.id);
    expect(plan.decisionIds).toEqual([d1.id]);
    expect(plan.actionIds).toEqual([act1.id]);

    const after = {
      m1: (await store.getMemory(m1.id))?.status,
      d1: (await store.getDecision(d1.id))?.status,
      act1: (await store.getAction(act1.id))?.status,
      revocations: (await (store as unknown as { revocations: unknown[] }).revocations).length,
    };
    expect(after).toEqual(before);
    expect(before.m1).toBe("trusted");
  });

  it("handles a root that is a source node", async () => {
    const store = getStore();
    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const chain = await (await import("../lib/pipeline/causality")).getCausalChain(ingestion.created[0].id);
    const plan = await computeBlastRadius(chain.source!.id);
    expect(plan.memoryIds).toContain(ingestion.created[0].id);
    expect(plan.decisionIds.length).toBe(0);
  });
});

describe("execute repair", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    resetStore();
    useEmptyDemoStore();
  });

  it("revokes, quarantines, invalidates, cancels, and flags review; preserves history", async () => {
    const store = getStore();
    const { actionStatus } = internals(store);
    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const m1 = ingestion.created[0];
    const d1 = await recordDecision({ agentId: "a-proc", memoryIds: [m1.id], summary: "Approve" });
    const d1m = await recordDerivedMemory({ decisionId: d1.id, label: "Approved supplier", detail: "Poison Corp is an approved supplier." });
    const d2 = await recordDecision({ agentId: "a-fin", memoryIds: [d1m.id], summary: "Pay" });
    const pending = await recordAction({ decisionId: d2.id, actionType: "wire_transfer", payload: {} });
    const done = await recordAction({ decisionId: d2.id, actionType: "wire_transfer", payload: {} });
    actionStatus(done.id, "completed");

    const plan = await computeBlastRadius(m1.id);
    const result = await executeRepair(plan, { actor: "sec-01", reason: "confirmed poisoning" });
    expect(result.executed).toBe(true);
    expect(result.cancelActionIds).toEqual([pending.id]);
    expect(result.reviewActionIds).toEqual([done.id]);

    // Terminal statuses per artifact class.
    expect((await store.getMemory(m1.id))?.status).toBe("repaired");
    expect((await store.getMemory(d1m.id))?.status).toBe("quarantined");
    expect((await store.getDecision(d1.id))?.status).toBe("invalidated");
    expect((await store.getDecision(d2.id))?.status).toBe("invalidated");
    expect((await store.getAction(pending.id))?.status).toBe("cancelled");
    expect((await store.getAction(done.id))?.status).toBe("requires_review");

    // Historical data is preserved, never deleted.
    expect(await store.getMemory(m1.id)).toBeTruthy();
    expect(await store.getMemory(d1m.id)).toBeTruthy();

    // Affected cases are enqueued for re-evaluation.
    const reevaluations = await store.listReEvaluations();
    expect(reevaluations.some((r) => r.agentId === "a-fin" && r.decisionId === d2.id && r.status === "pending")).toBe(true);
    expect(reevaluations.some((r) => r.agentId === "a-proc" && r.decisionId === d1.id)).toBe(true);
  });

  it("is idempotent across repeated calls and does not duplicate evidence", async () => {
    const store = getStore();
    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const m1 = ingestion.created[0];
    await recordDecision({ agentId: "a-proc", memoryIds: [m1.id], summary: "Approve" });
    const plan = await computeBlastRadius(m1.id);

    const first = await executeRepair(plan, { actor: "sec-01" });
    const second = await executeRepair(plan, { actor: "sec-01" });
    const third = await executeRepair(plan, { actor: "sec-01" });

    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);
    expect(third.executed).toBe(false);
    expect(second.repairId).toBe(first.repairId);
    expect(third.repairId).toBe(first.repairId);
    expect(second.reEvaluationIds).toEqual(first.reEvaluationIds);

    const revocations = (await store.listReEvaluations()).length;
    expect(revocations).toBeGreaterThan(0);
    const contaminations = await (store as unknown as { contaminations: { severity: string; memoryId: string }[] }).contaminations;
    expect(contaminations.filter((c) => c.memoryId === m1.id && c.severity === "critical").length).toBe(1);
  });

  it("replays a follow-up repair even when the plan shifts after cancellation", async () => {
    const store = getStore();
    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const m1 = ingestion.created[0];
    const d1 = await recordDecision({ agentId: "a-proc", memoryIds: [m1.id], summary: "Approve" });
    const act1 = await recordAction({ decisionId: d1.id, actionType: "wire_transfer", payload: {} });

    const first = await executeRepair(await computeBlastRadius(m1.id), { actor: "sec-01" });
    expect(first.executed).toBe(true);

    // A second call recomputes the plan: the action is already cancelled, so the
    // plan differs, but the root is repaired: the call must replay, not re-run.
    const secondPlan = await computeBlastRadius(m1.id);
    expect(secondPlan.cancelActionIds).toEqual([]);
    const second = await executeRepair(secondPlan, { actor: "sec-01" });
    expect(second.executed).toBe(false);
    expect(second.repairId).toBe(first.repairId);
    const contaminations = await (store as unknown as { contaminations: { severity: string; memoryId: string }[] }).contaminations;
    expect(contaminations.filter((c) => c.memoryId === m1.id && c.severity === "critical").length).toBe(1);
  });

  it("serializes concurrent repair attempts so exactly one executes", async () => {
    const store = getStore();
    const ingestion = await ingestDocument({ sourceUri: "s3://x/poison.pdf", content: POISON_DOC });
    const m1 = ingestion.created[0];
    await recordDecision({ agentId: "a-proc", memoryIds: [m1.id], summary: "Approve" });
    const plan = await computeBlastRadius(m1.id);

    const [a, b] = await Promise.all([executeRepair(plan, { actor: "sec-a" }), executeRepair(plan, { actor: "sec-b" })]);
    expect([a.executed, b.executed].filter(Boolean)).toHaveLength(1);
    expect(a.repairId).toBe(b.repairId);
    expect((await store.getMemory(m1.id))?.status).toBe("repaired");
    const revocations = await (store as unknown as { revocations: unknown[] }).revocations;
    expect(revocations.filter((r) => (r as { memoryId: string }).memoryId === m1.id).length).toBe(1);
  });
});
