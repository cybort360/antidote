import { beforeEach, describe, expect, it } from "vitest";
import { computeBlastRadius, executeRepair } from "../lib/recovery";
import { getCausalChain } from "../lib/pipeline/causality";
import { getStore, resetStore } from "../lib/store";

describe("recovery", () => {
  beforeEach(() => resetStore());

  it("computes the full blast radius of a root memory", async () => {
    const plan = await computeBlastRadius("m-184");
    expect(plan.memoryIds.sort()).toEqual(["m-211", "m-229"]);
    expect(plan.decisionIds.sort()).toEqual(["d-441", "d-452"]);
    expect(plan.actionIds).toEqual(["act-91"]);
    expect(plan.needsReevaluation.sort()).toEqual(["a-fin", "a-ops", "a-proc"]);
  });

  it("returns an empty plan for an isolated memory", async () => {
    const { ingestDocument } = await import("../lib/pipeline/ingest");
    const result = await ingestDocument({ sourceUri: "s3://b/isolated.txt", content: "A standalone fact with no dependents." });
    const plan = await computeBlastRadius(result.created[0].id);
    expect(plan.memoryIds).toEqual([]);
    expect(plan.decisionIds).toEqual([]);
    expect(plan.actionIds).toEqual([]);
    expect(plan.needsReevaluation).toEqual([]);
  });

  it("executes a repair transactionally", async () => {
    const plan = await computeBlastRadius("m-184");
    const result = await executeRepair(plan, { actor: "security-agent", reason: "confirmed poisoning" });
    expect(result.status).toBe("completed");
    expect(result.repairId).toBeTruthy();

    const byId = new Map((await getStore().listMemories()).map((n) => [n.id, n.status]));
    expect(byId.get("m-184")).toBe("repaired");
    expect(byId.get("m-211")).toBe("quarantined");
    expect(byId.get("m-229")).toBe("quarantined");
    expect(byId.get("d-441")).toBe("invalidated");
    expect(byId.get("d-452")).toBe("invalidated");
    expect(byId.get("act-91")).toBe("cancelled");
    const action = await getStore().getAction("act-91");
    expect(action?.status).toBe("cancelled");
  });

  it("records revocation + audit evidence for the root memory", async () => {
    const plan = await computeBlastRadius("m-184");
    await executeRepair(plan, { actor: "sec-01", reason: "attack confirmed" });
    const chain = await getCausalChain("m-184");
    expect(chain.decisions.every((d) => d.status === "invalidated")).toBe(true);
  });

  it("keeps the scenario queryable in repaired phase", async () => {
    const plan = await computeBlastRadius("m-184");
    await executeRepair(plan, { actor: "sec-01" });
    const scenario = await getStore().getScenario();
    expect(scenario.phase).toBe("repaired");
    expect(scenario.title).toBe("Containment complete");
    const root = scenario.nodes.find((n) => n.id === "m-184");
    expect(root?.status).toBe("repaired");
  });
});

describe("scenario view", () => {
  beforeEach(() => resetStore());

  it("serves the seeded demo scenario", async () => {
    const scenario = await getStore().getScenario();
    expect(scenario.nodes.length).toBe(10);
    expect(scenario.edges.length).toBe(9);
    expect(scenario.phase).toBe("infected");
    expect(scenario.blastRadius).toEqual({ memories: 3, decisions: 2, actions: 1, agents: 3 });
    const m184 = scenario.nodes.find((n) => n.id === "m-184");
    expect(m184?.usedBy).toBeGreaterThanOrEqual(2);
    expect(m184?.descendants).toBeGreaterThanOrEqual(6);
  });

  it("reports live blast radius after new derived memories", async () => {
    const scenario = await getStore().getScenario();
    expect(scenario.blastRadius.memories).toBe(3);
  });
});
