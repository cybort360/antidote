import { createHmac, timingSafeEqual } from "node:crypto";

export type ReEvaluationCallbackPayload = {
  reEvaluationId: string;
  agentId: string;
  originalDecision: { id: string; summary: string; detail?: string } | null;
  memories: { id: string; label: string; detail: string; status: string }[];
};

export type ReEvaluationCallbackResult = {
  outcome: "refused" | "replaced";
  reason: string;
  decision?: { summary: string; detail?: string };
};

export function signReEvaluationCallback(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

export function verifyReEvaluationCallbackSignature(input: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
}): boolean {
  const expected = Buffer.from(signReEvaluationCallback(input.secret, input.timestamp, input.body));
  const received = Buffer.from(input.signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function invokeReEvaluationCallback(input: {
  url: string;
  secret: string;
  payload: ReEvaluationCallbackPayload;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
}): Promise<ReEvaluationCallbackResult> {
  const body = JSON.stringify(input.payload);
  const timestamp = String(Math.floor((input.now?.() ?? Date.now()) / 1000));
  const response = await (input.fetchImpl ?? globalThis.fetch)(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-antidote-timestamp": timestamp,
      "x-antidote-signature": signReEvaluationCallback(input.secret, timestamp, body),
    },
    body,
  });

  if (!response.ok) throw new Error(`Re-evaluation callback returned ${response.status}`);
  const value = await response.json() as {
    outcome?: "refused" | "replaced";
    reason?: string;
    decision?: { summary?: string; detail?: string };
  };
  if (!value.reason || !["refused", "replaced"].includes(value.outcome ?? "")) {
    throw new Error("Re-evaluation callback returned an invalid outcome");
  }
  if (value.outcome === "replaced" && !value.decision?.summary) {
    throw new Error("Replacement callback outcome requires decision.summary");
  }

  return value as ReEvaluationCallbackResult;
}
