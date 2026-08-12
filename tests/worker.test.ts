import { beforeEach, describe, expect, it } from "vitest";
import { handler } from "../aws/repair-worker";
import { getStore, resetStore, useEmptyDemoStore } from "../lib/store";
import { runZenithScenario } from "../lib/agents/runScenario";

describe("repair worker entrypoint", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    resetStore();
    useEmptyDemoStore();
  });

  it("reports malformed SQS records for partial batch retry", async () => {
    const result = await handler({ Records: [{ messageId: "bad-1", body: "not-json" }] }) as {
      batchItemFailures: { itemIdentifier: string }[];
      results: unknown[];
    };
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "bad-1" }]);
    expect(result.results).toEqual([]);
  });

  it("drains queued agent work from a scheduled event", async () => {
    await runZenithScenario({ fresh: true, repair: true });
    const before = await getStore().listReEvaluations(100);
    expect(before.some((entry) => entry.status === "pending")).toBe(true);

    const result = await handler({ source: "aws.events", "detail-type": "Scheduled Event" }) as {
      processed: string[];
      failed: string[];
    };
    expect(result.processed.length).toBeGreaterThan(0);
    expect(result.failed).toEqual([]);
    const after = await getStore().listReEvaluations(100);
    expect(after.every((entry) => entry.status === "completed")).toBe(true);
  });
});
