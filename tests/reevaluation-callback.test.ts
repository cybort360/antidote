import { describe, expect, it, vi } from "vitest";
import {
  invokeReEvaluationCallback,
  signReEvaluationCallback,
  verifyReEvaluationCallbackSignature,
  type ReEvaluationCallbackPayload,
} from "../lib/agents/reevaluation-callback";

const payload: ReEvaluationCallbackPayload = {
  reEvaluationId: "reeval-1",
  agentId: "custom-agent",
  originalDecision: { id: "decision-1", summary: "Pay vendor" },
  memories: [{ id: "memory-1", label: "Vendor", detail: "Verified bank details", status: "active" }],
};

describe("custom agent re-evaluation callback", () => {
  it("signs the exact timestamp and request body", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      outcome: "replaced",
      reason: "Trusted evidence supports a replacement",
      decision: { summary: "Pay verified vendor" },
    }), { status: 200 }));

    const result = await invokeReEvaluationCallback({
      url: "https://agent.example/reevaluate",
      secret: "callback-secret",
      payload,
      fetchImpl: request,
      now: () => 1_720_000_000_000,
    });

    const [, init] = request.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    const body = String(init?.body);
    expect(headers["x-antidote-timestamp"]).toBe("1720000000");
    expect(headers["x-antidote-signature"]).toBe(signReEvaluationCallback("callback-secret", "1720000000", body));
    expect(verifyReEvaluationCallbackSignature({
      secret: "callback-secret",
      timestamp: headers["x-antidote-timestamp"],
      body,
      signature: headers["x-antidote-signature"],
    })).toBe(true);
    expect(result.outcome).toBe("replaced");
  });

  it("rejects malformed replacement responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ outcome: "replaced", reason: "done" }), { status: 200 }));
    await expect(invokeReEvaluationCallback({
      url: "https://agent.example/reevaluate",
      secret: "secret",
      payload,
      fetchImpl: request,
    })).rejects.toThrow("decision.summary");
  });

  it("rejects altered signatures", () => {
    expect(verifyReEvaluationCallbackSignature({
      secret: "callback-secret",
      timestamp: "1720000000",
      body: JSON.stringify(payload),
      signature: `sha256=${"0".repeat(64)}`,
    })).toBe(false);
  });
});
