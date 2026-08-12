import { beforeEach, describe, expect, it } from "vitest";
import { ingestDocument } from "../lib/pipeline/ingest";
import { retrieveMemories } from "../lib/pipeline/retrieve";
import { recordAction, recordDecision, recordDerivedMemory } from "../lib/pipeline/decision";
import { getCausalChain } from "../lib/pipeline/causality";
import { getStore, resetStore } from "../lib/store";

const DOC = "Zenith Systems settlements use account ACCT-8842 for all vendor payments.\n\nZenith Systems is an approved supplier for procurement.";
const DOC_URI = "s3://antidote-evidence/zenith-policy.pdf";

describe("ingestion pipeline", () => {
  beforeEach(() => resetStore());

  it("ingests a document and stores memories with provenance", async () => {
    const result = await ingestDocument({ sourceUri: DOC_URI, content: DOC, actor: "harness" });
    expect(result.status).toBe("completed");
    expect(result.stats.candidates).toBeGreaterThan(0);
    expect(result.created.length).toBe(result.stats.candidates);
    const first = result.created[0];
    expect(first.kind).toBe("memory");
    expect(first.sourceUri).toBe(DOC_URI);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const stored = await getStore().getMemory(first.id);
    expect(stored?.id).toBe(first.id);
    expect(stored?.metadata.extractor).toBe("pipeline");
  });

  it("is idempotent via idempotencyKey", async () => {
    const first = await ingestDocument({ sourceUri: DOC_URI, content: DOC, idempotencyKey: "job-1" });
    const memoryCountBefore = (await getStore().listMemories()).length;
    const second = await ingestDocument({ sourceUri: DOC_URI, content: DOC, idempotencyKey: "job-1" });
    expect(second.jobId).toBe(first.jobId);
    expect(second).toEqual(first);
    const memoryCountAfter = (await getStore().listMemories()).length;
    expect(memoryCountAfter).toBe(memoryCountBefore);
  });

  it("deduplicates by content hash when re-ingesting without a key", async () => {
    const first = await ingestDocument({ sourceUri: DOC_URI, content: DOC });
    const second = await ingestDocument({ sourceUri: DOC_URI, content: DOC });
    expect(first.stats.created).toBeGreaterThan(0);
    expect(second.stats.created).toBe(0);
    expect(second.duplicates.length).toBeGreaterThan(0);
    expect(second.duplicates.map((m) => m.contentHash)).toEqual(first.created.map((m) => m.contentHash));
  });

  it("does not duplicate candidates within one document", async () => {
    const result = await ingestDocument({ sourceUri: DOC_URI, content: DOC });
    const hashes = result.created.map((m) => m.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("records a failed job when extraction fails", async () => {
    await expect(ingestDocument({ sourceUri: DOC_URI, content: "   " })).rejects.toThrow(/no extractable memory content/i);
    const jobs = await getStore().listIngestions();
    expect(jobs.some((j) => j.status === "failed" && j.error?.includes("no extractable memory content"))).toBe(true);
  });

  it("rejects invalid input", async () => {
    await expect(ingestDocument({ sourceUri: DOC_URI, content: "" })).rejects.toThrow();
  });
});

describe("retrieval pipeline", () => {
  beforeEach(() => resetStore());

  it("returns seeded memories and records retrieval events", async () => {
    const { results } = await retrieveMemories({ agentId: "a-proc", query: "settlement account for Zenith" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memory.id).toBe("m-184");
    expect(results[0].eventId).toBeTruthy();
    const events = await getStore().listRetrievalEvents(50);
    expect(events.some((e) => e.agentId === "a-proc" && e.memoryId === "m-184" && e.queryText.includes("settlement"))).toBe(true);
  });

  it("records events for ingested memories", async () => {
    await ingestDocument({ sourceUri: DOC_URI, content: DOC });
    const { results } = await retrieveMemories({ agentId: "a-proc", query: "Zenith settlements ACCT-8842" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.memory.kind === "memory" || r.memory.kind === "derived")).toBe(true);
    const events = await getStore().listRetrievalEvents(50, "a-proc");
    expect(events.length).toBeGreaterThan(0);
  });

  it("applies k limit", async () => {
    const { results } = await retrieveMemories({ agentId: "a", query: "Zenith", k: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("decision pipeline", () => {
  beforeEach(() => resetStore());

  it("records which memories influenced a decision", async () => {
    const decision = await recordDecision({ agentId: "a-proc", memoryIds: ["m-184"], summary: "Approve Zenith as vendor" });
    expect(decision.memoryIds).toEqual(["m-184"]);
    const stored = await getStore().getDecision(decision.id);
    expect(stored?.memoryIds).toEqual(["m-184"]);
    expect(stored?.agentId).toBe("a-proc");
  });

  it("links matching retrieval events to the decision", async () => {
    await retrieveMemories({ agentId: "a-proc", query: "settlement account" });
    const decision = await recordDecision({ agentId: "a-proc", memoryIds: ["m-184"], summary: "Approve Zenith" });
    const events = await getStore().listRetrievalEvents(50, "a-proc");
    expect(events.filter((e) => e.decisionId === decision.id).length).toBeGreaterThan(0);
  });

  it("rejects unknown memory inputs", async () => {
    await expect(recordDecision({ agentId: "a", memoryIds: ["nope-1"], summary: "bad" })).rejects.toThrow();
  });

  it("is idempotent via idempotencyKey", async () => {
    const a = await recordDecision({ agentId: "a-proc", memoryIds: ["m-184"], summary: "Approve", idempotencyKey: "dec-1" });
    const b = await recordDecision({ agentId: "a-proc", memoryIds: ["m-184"], summary: "Approve", idempotencyKey: "dec-1" });
    expect(b.id).toBe(a.id);
  });

  it("records actions produced by a decision", async () => {
    const decision = await recordDecision({ agentId: "a-fin", memoryIds: ["m-184"], summary: "Prepare payment" });
    const action = await recordAction({ decisionId: decision.id, actionType: "wire_transfer", payload: { amount: 24000, currency: "USD" }, summary: "$24k transfer" });
    expect(action.status).toBe("pending");
    expect(action.decisionId).toBe(decision.id);
    const stored = await getStore().getAction(action.id);
    expect(stored?.payload.amount).toBe(24000);
  });

  it("rejects actions against unknown decisions", async () => {
    await expect(recordAction({ decisionId: "d-missing", actionType: "wire" })).rejects.toThrow();
  });

  it("records derived memories from decisions with embeddings", async () => {
    const decision = await recordDecision({ agentId: "a-ops", memoryIds: ["m-211"], summary: "Establish supplier ops" });
    const derived = await recordDerivedMemory({ decisionId: decision.id, label: "M-501", detail: "Zenith has an established trusted payment history." });
    expect(derived.kind).toBe("derived");
    const stored = await getStore().getMemory(derived.id);
    expect(stored?.metadata.parentDecisionId).toBe(decision.id);
  });

  it("is idempotent for derived memories", async () => {
    const decision = await recordDecision({ agentId: "a-ops", memoryIds: ["m-211"], summary: "Ops decision" });
    const a = await recordDerivedMemory({ decisionId: decision.id, label: "M-1", detail: "same fact", idempotencyKey: "der-1" });
    const b = await recordDerivedMemory({ decisionId: decision.id, label: "M-1", detail: "same fact", idempotencyKey: "der-1" });
    expect(b.id).toBe(a.id);
  });
});

describe("causal chain", () => {
  beforeEach(() => resetStore());

  it("exposes source -> memory -> retrieval -> decision -> action -> derived", async () => {
    const chain = await getCausalChain("m-184");
    expect(chain.rootMemoryId).toBe("m-184");
    expect(chain.source?.kind).toBe("source");
    expect(chain.source?.id).toBe("src-17");
    expect(chain.retrievals.length).toBeGreaterThanOrEqual(2);
    expect(chain.decisions.map((d) => d.id).sort()).toEqual(["d-441", "d-452"]);
    expect(chain.actions.map((a) => a.id)).toEqual(["act-91"]);
    expect(chain.derived.map((m) => m.id).sort()).toEqual(["m-211", "m-229"]);
    expect(chain.decisions.every((d) => d.memoryIds.includes("m-184"))).toBe(true);
  });

  it("rejects unknown memories", async () => {
    await expect(getCausalChain("m-unknown")).rejects.toThrow();
  });
});
