import { beforeEach, describe, expect, it } from "vitest";
import { resetStore, useEmptyDemoStore, getStore } from "../lib/store";
import { SimulatedMcpBackend, runMcpOperation, MCP_CAPABILITIES, resetMcpBackend, getMcpBackend } from "../lib/mcp/client";
import { redactValue } from "../lib/mcp/redact";
import { runZenithScenario } from "../lib/agents/runScenario";
import { processReevaluations } from "../aws/repair-worker";

describe("secret redaction", () => {
  it("redacts credentials, keys, and connection strings", () => {
    const input = {
      uri: "postgresql://user:supersecret@host:26257/defaultdb?sslmode=verify-full",
      apiKey: "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secretvalue",
      aws: "AKIAIOSFODNN7EXAMPLE",
      safe: { memoryId: "m-184", count: 3 },
      nested: { token: "sk-abcdef1234567890", list: ["ok", "postgres://u:p@h:1/db"] },
    };
    const redacted = redactValue(input) as Record<string, unknown>;
    expect(redacted.uri).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.aws).toBe("[REDACTED]");
    expect(redacted.safe).toEqual({ memoryId: "m-184", count: 3 });
    expect((redacted.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect(((redacted.nested as { list: string[] }).list)[1]).toBe("[REDACTED]");
  });

  it("keeps forensic identifiers intact", () => {
    const redacted = redactValue({ memoryId: "m-184", decisionId: "d-441", similarity: 0.91 });
    expect(redacted).toEqual({ memoryId: "m-184", decisionId: "d-441", similarity: 0.91 });
  });
});

describe("governed MCP operations", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    resetStore();
    useEmptyDemoStore();
    resetMcpBackend();
  });

  it("serves the simulated backend in demo mode with the full capability set", async () => {
    expect(getMcpBackend().provider).toBe("simulated-local-store");
    expect(MCP_CAPABILITIES.sort()).toEqual(["get_blast_radius", "get_memory_lineage", "get_repair_status", "get_schema", "list_tables"]);
  });

  it("runs each capability and returns real evidence from the store", async () => {
    const run = await runZenithScenario({ fresh: true, repair: true });
    const backend = new SimulatedMcpBackend();
    await backend.initialize();

    const tables = (await backend.call("list_tables", {})) as { tables: string[]; rowCounts: Record<string, number> };
    expect(tables.tables).toContain("memory_nodes");
    expect(tables.rowCounts.memory_nodes).toBeGreaterThan(0);

    const schema = (await backend.call("get_schema", {})) as { schema: { table: string }[] };
    expect(schema.schema.some((s) => s.table === "repair_jobs")).toBe(true);

    const lineage = (await backend.call("get_memory_lineage", { memoryId: run.procurement.poisonedMemoryId })) as { decisions: unknown[]; actions: unknown[]; derivedMemories: unknown[] };
    expect(lineage.decisions.length).toBe(3);
    expect(lineage.actions.length).toBe(1);
    expect(lineage.derivedMemories.length).toBe(2);

    const blast = (await backend.call("get_blast_radius", { memoryId: run.procurement.poisonedMemoryId })) as { decisions: unknown[]; actionsRequiringReview: unknown[] };
    expect(blast.decisions.length).toBe(3);

    const repair = (await backend.call("get_repair_status", {})) as { repairJobs: unknown[]; pendingReevaluations: number };
    expect(repair.repairJobs.length).toBeGreaterThan(0);
    expect(repair.pendingReevaluations).toBeGreaterThan(0);
  });

  it("records every operation in the trace with agent, capability, status, duration", async () => {
    await runZenithScenario({ fresh: true, repair: true });
    const operation = await runMcpOperation({ agentId: "a-sec", capability: "get_memory_lineage", params: { memoryId: "m-does-not-exist" } });
    expect(operation.status).toBe("failed");
    expect(operation.agentId).toBe("a-sec");
    expect(operation.error).toContain("does not exist");

    const ok = await runMcpOperation({ capability: "list_tables" });
    expect(ok.status).toBe("completed");
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);

    const ops = await getStore().listMcpOperations(50);
    expect(ops.length).toBe(2);
    expect(new Set(ops.map((o) => o.capability))).toEqual(new Set(["get_memory_lineage", "list_tables"]));
    expect(ops.every((o) => o.agentId === "a-sec")).toBe(true);
    expect(ops.every((o) => !JSON.stringify(o.params).includes("secret"))).toBe(true);
    const ids = new Set(ops.map((o) => o.id));
    expect(ids.size).toBe(2);
  });

  it("rejects unknown capabilities before invocation", async () => {
    const store = getStore();
    const before = (await store.listMcpOperations(100)).length;
    // @ts-expect-error unknown capability must be rejected by validation
    await expect(runMcpOperation({ capability: "drop_all_tables" })).rejects.toThrow();
    expect((await store.listMcpOperations(100)).length).toBe(before);
  });
});

describe("async re-evaluation processing", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    resetStore();
    useEmptyDemoStore();
  });

  it("drains the pending re-evaluation queue idempotently", async () => {
    await runZenithScenario({ fresh: true, repair: true });
    const store = getStore();
    const pending = (await store.listReEvaluations(100)).filter((r) => r.status === "pending");
    expect(pending.length).toBeGreaterThan(0);

    const first = (await processReevaluations()) as { processed: string[]; failed: string[] };
    expect(first.processed.length).toBe(pending.length);
    expect(first.failed).toEqual([]);

    const second = (await processReevaluations()) as { processed: string[]; failed: string[] };
    expect(second.processed).toEqual([]);
    const now = await store.listReEvaluations(100);
    expect(now.every((r) => r.status === "completed" && Boolean(r.completedAt))).toBe(true);
  });
});
