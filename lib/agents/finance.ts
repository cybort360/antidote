import { z } from "zod";
import { retrieveMemories } from "../pipeline/retrieve";
import { recordAction, recordDecision } from "../pipeline/decision";
import { requireAgent } from "./registry";
import { beginAgentRun, finishAgentRun } from "./base";
import { structuredCompletion } from "./llm";
import type { AgentRunMeta } from "./base";

const DecisionContentSchema = z.object({
  summary: z.string().min(1).max(200),
  detail: z.string().min(1).max(500),
});

export type FinanceResult = AgentRunMeta & {
  kind: "finance";
  query: string;
  refused?: boolean;
  refusalReason?: string;
  retrievals: { memoryId: string; similarity: number; eventId: string }[];
  decisionId?: string;
  decisionSummary?: string;
  decisionDetail?: string;
  decisionMemoryIds: string[];
  actionId?: string;
  actionType?: string;
  actionStatus?: string;
  payload?: Record<string, unknown>;
};

export type FinanceOptions = {
  runId?: string;
  deterministic?: boolean;
  query?: string;
  freshSession?: boolean;
};

export async function runFinance(options: FinanceOptions = {}): Promise<FinanceResult> {
  const agent = requireAgent("finance");
  const runId = options.runId ?? `run-${Date.now()}`;
  const { meta, session } = await beginAgentRun(agent, runId, { role: "payment preparation" }, options.freshSession);

  // 1) Retrieve memory evidence; every hit is logged as a retrieval event with
  //    the agent's session attached.
  const query = options.query ?? "approved supplier settlement";
  const { results, poisonMatches } = await retrieveMemories({ agentId: agent.id, query, k: 5, context: { runId } });
  const retrievals = results.map((r) => ({ memoryId: r.memory.id, similarity: r.similarity, eventId: r.eventId }));
  const memoryIds = results.map((r) => r.memory.id);

  // A fresh agent must REFUSE to act when its only evidence depends on revoked
  // memory: retrieval never returns revoked/quarantined/repaired memories, so
  // after a repair the approval evidence is gone and there is nothing to
  // prepare a payment from. Refusal is recorded, not a decision.
  if (memoryIds.length === 0) {
    return finishAgentRun(meta, {
      kind: "finance",
      query,
      refused: true,
      refusalReason: "No trusted memory evidence retrieved — the prior approval depended on revoked memory and was not re-derived from clean state.",
      retrievals,
      decisionMemoryIds: [],
    });
  }

  // 2) Decide which payment to prepare based on the retrieved evidence.
  const evidence = results.map((r) => `[${r.memory.id}] ${r.memory.detail}`).join("\n");
  const llm = await structuredCompletion({
    system: agent.systemPrompt,
    user: `Retrieved memory evidence:\n${evidence || "(no evidence retrieved)"}`,
    schema: DecisionContentSchema,
    deterministic: options.deterministic,
    fallback: () => ({ summary: "Payment prepared", detail: "$24,000 settlement prepared for the retrieved counterparty." }),
  });
  meta.llmSource = llm.source;

  // 3) Record the decision with the exact memory IDs that influenced it.
  const decision = await recordDecision({
    agentId: agent.id,
    memoryIds,
    summary: llm.content.summary,
    detail: llm.content.detail,
    context: { sessionId: session.id, runId, poisonMatchCount: poisonMatches.length },
  });

  // 4) Prepare the external wire transfer as a safely simulated action.
  const account = (results.find((r) => /ACCT-\d{4,}/i.test(r.memory.detail))?.memory.detail ?? "").match(/\b(ACCT-\d{4,})\b/i)?.[1] ?? "on-file";
  const action = await recordAction({
    decisionId: decision.id,
    actionType: "wire_transfer",
    summary: "$24,000 settlement transfer",
    payload: { amount: 24000, currency: "USD", account, simulated: true, preparedBy: agent.id },
  });

  return finishAgentRun(meta, {
    kind: "finance",
    query,
    retrievals,
    decisionId: decision.id,
    decisionSummary: decision.summary,
    decisionDetail: decision.detail,
    decisionMemoryIds: decision.memoryIds,
    actionId: action.id,
    actionType: action.actionType,
    actionStatus: action.status,
    payload: action.payload,
  });
}
