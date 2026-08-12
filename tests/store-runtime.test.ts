import { describe, expect, it, vi } from "vitest";

describe("server process store runtime", () => {
  it("keeps one demo store across route-style module reloads", async () => {
    const firstModule = await import("../lib/store");
    firstModule.resetStore(false);
    const first = firstModule.getStore();
    await first.audit("runtime.proof", "test", "object-1", { shared: true });

    vi.resetModules();
    const secondModule = await import("../lib/store");
    const second = secondModule.getStore();

    expect(second).toBe(first);
    await expect(second.listAuditEvents()).resolves.toMatchObject([
      { eventType: "runtime.proof", actor: "test", objectId: "object-1" },
    ]);
    secondModule.resetStore();
  });
});
