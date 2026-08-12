import { describe, expect, it, vi } from "vitest";
import { AntidoteClient } from "../sdk/index";

describe("TypeScript SDK", () => {
  it("sends tenant bearer authentication and typed JSON input", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [], poisonMatches: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = new AntidoteClient({ baseUrl: "https://antidote.example/", apiKey: "tenant-key", fetch: request });

    await client.retrieve({ agentId: "finance-agent", query: "trusted supplier evidence", k: 3 });

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://antidote.example/api/retrieve");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json", authorization: "Bearer tenant-key" });
    expect(JSON.parse(String(init?.body))).toEqual({ agentId: "finance-agent", query: "trusted supplier evidence", k: 3 });
  });

  it("encodes resource IDs and builds simulation and repair requests", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ mode: "simulation", affected: {}, plan: {} }), { status: 200 }));
    const client = new AntidoteClient({ fetch: request });

    await client.recordAction("decision/42", { actionType: "payment", summary: "Hold payment" });
    await client.simulateRepair("memory/7", { reason: "failed integrity check" });

    expect(request.mock.calls[0][0]).toBe("http://localhost:3000/api/decisions/decision%2F42/actions");
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ memoryId: "memory/7", execute: false, reason: "failed integrity check" });
  });

  it("maps API error envelopes to AntidoteApiError", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "FORBIDDEN", message: "Writer role required", details: { role: "reader" } },
    }), { status: 403 }));
    const client = new AntidoteClient({ fetch: request });

    await expect(client.ingest({ sourceUri: "vendor.pdf", content: "safe" })).rejects.toMatchObject({
      name: "AntidoteApiError",
      status: 403,
      code: "FORBIDDEN",
      message: "Writer role required",
      details: { role: "reader" },
    });
  });
});
