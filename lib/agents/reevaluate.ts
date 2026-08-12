import { retrieveMemories } from "../pipeline/retrieve";
import { recordDecision } from "../pipeline/decision";
import type { ReEvaluation } from "../types";
import { runFinance } from "./finance";
import { runOperations } from "./operations";
import { beginAgentRun, finishAgentRun } from "./base";
import { getAgent } from "./registry";
import { env } from "../config";
import { invokeReEvaluationCallback } from "./reevaluation-callback";

export type ReEvaluationResult = {
  outcome: "replaced" | "refused";
  agentId: string;
  originalDecisionId?: string;
  replacementDecisionId?: string;
  memoryIds: string[];
  reason: string;
  run: Record<string, unknown>;
};

function asRecord(value: object): Record<string, unknown> {
  return { ...value } as Record<string, unknown>;
}

export async function reevaluateAffectedAgent(entry: ReEvaluation): Promise<ReEvaluationResult> {
  const agent = getAgent(entry.agentId);
  const runId = `reeval-${entry.id}`;

  if (!agent) return reevaluateExternalAgent(entry, runId);

  if (agent.kind === "finance") {
    const run = await runFinance({ runId, query: "approved supplier settlement", freshSession: true });
    return {
      outcome: run.refused ? "refused" : "replaced",
      agentId: agent.id,
      originalDecisionId: entry.decisionId,
      replacementDecisionId: run.decisionId,
      memoryIds: run.decisionMemoryIds,
      reason: run.refusalReason ?? "The finance agent produced a replacement decision from surviving trusted memories.",
      run: asRecord(run),
    };
  }

  if (agent.kind === "operations") {
    const run = await runOperations({ runId, query: "approved suppliers", freshSession: true });
    return {
      outcome: run.refused ? "refused" : "replaced",
      agentId: agent.id,
      originalDecisionId: entry.decisionId,
      replacementDecisionId: run.decisionId,
      memoryIds: run.decisionMemoryIds,
      reason: run.refusalReason ?? "The operations agent produced a replacement decision from surviving trusted memories.",
      run: asRecord(run),
    };
  }

  if (agent.kind === "procurement") {
    const { meta, session } = await beginAgentRun(agent, runId, { role: "clean-memory re-evaluation", reEvaluationId: entry.id }, true);
    const query = "verified vendor qualification evidence";
    const { results } = await retrieveMemories({ agentId: agent.id, query, k: 5, context: { runId, reEvaluationId: entry.id } });
    const memoryIds = results.map((result) => result.memory.id);

    if (memoryIds.length === 0) {
      const run = finishAgentRun(meta, {
        kind: "procurement" as const,
        query,
        refused: true,
        refusalReason: "No trusted vendor evidence survived the repair, so the prior approval was not recreated.",
        retrievals: [],
        decisionMemoryIds: [],
      });
      return {
        outcome: "refused",
        agentId: agent.id,
        originalDecisionId: entry.decisionId,
        memoryIds: [],
        reason: run.refusalReason,
        run: asRecord(run),
      };
    }

    const decision = await recordDecision({
      agentId: agent.id,
      memoryIds,
      summary: "Vendor qualification requires review",
      detail: "The replacement decision uses only trusted memories that survived causal repair.",
      idempotencyKey: `reevaluation-decision-${entry.id}`,
      context: { sessionId: session.id, runId, reEvaluationId: entry.id, replacesDecisionId: entry.decisionId },
    });
    const run = finishAgentRun(meta, {
      kind: "procurement" as const,
      query,
      refused: false,
      retrievals: results.map((result) => ({ memoryId: result.memory.id, similarity: result.similarity, eventId: result.eventId })),
      decisionId: decision.id,
      decisionMemoryIds: decision.memoryIds,
    });
    return {
      outcome: "replaced",
      agentId: agent.id,
      originalDecisionId: entry.decisionId,
      replacementDecisionId: decision.id,
      memoryIds: decision.memoryIds,
      reason: "The procurement agent produced a review decision from surviving trusted memories.",
      run: asRecord(run),
    };
  }

  throw new Error(`Agent ${agent.id} has no clean-memory re-evaluation policy`);
}

async function reevaluateExternalAgent(entry: ReEvaluation, runId: string): Promise<ReEvaluationResult> {
  const store = (await import("../store")).getStore();
  const originalDecision = entry.decisionId ? await store.getDecision(entry.decisionId) : null;
  const session = await store.startFreshSession(entry.agentId, { role: "clean-memory re-evaluation", runId, reEvaluationId: entry.id });
  const query = originalDecision?.summary ? `trusted evidence for: ${originalDecision.summary}` : "trusted evidence for the affected decision";
  const { results } = await retrieveMemories({ agentId: entry.agentId, query, k: 8, context: { runId, reEvaluationId: entry.id, sessionId: session.id } });
  const memoryIds = results.map((result) => result.memory.id);
  const runBase = {
    agentId: entry.agentId,
    sessionId: session.id,
    runId,
    query,
    retrievals: results.map((result) => ({ memoryId: result.memory.id, similarity: result.similarity, eventId: result.eventId })),
  };

  if (memoryIds.length === 0) {
    return {
      outcome: "refused",
      agentId: entry.agentId,
      originalDecisionId: entry.decisionId,
      memoryIds: [],
      reason: "No trusted evidence survived the repair, so the custom agent was not asked to recreate its prior decision.",
      run: { ...runBase, refused: true },
    };
  }

  const callbackUrl = env().REEVALUATION_CALLBACK_URL;
  const callbackSecret = env().REEVALUATION_CALLBACK_SECRET;
  if (!callbackUrl || !callbackSecret) {
    throw new Error(`Custom agent ${entry.agentId} requires REEVALUATION_CALLBACK_URL and REEVALUATION_CALLBACK_SECRET`);
  }

  const payload = {
    reEvaluationId: entry.id,
    agentId: entry.agentId,
    originalDecision: originalDecision ? { id: originalDecision.id, summary: originalDecision.summary, detail: originalDecision.detail } : null,
    memories: results.map((result) => ({ id: result.memory.id, label: result.memory.label, detail: result.memory.detail, status: result.memory.status })),
  };
  const callback = await invokeReEvaluationCallback({ url: callbackUrl, secret: callbackSecret, payload });
  if (callback.outcome === "refused") {
    return {
      outcome: "refused",
      agentId: entry.agentId,
      originalDecisionId: entry.decisionId,
      memoryIds,
      reason: callback.reason,
      run: { ...runBase, refused: true, callback: "completed" },
    };
  }
  const decision = await recordDecision({
    agentId: entry.agentId,
    memoryIds,
    summary: callback.decision!.summary,
    detail: callback.decision!.detail,
    idempotencyKey: `reevaluation-decision-${entry.id}`,
    context: { sessionId: session.id, runId, reEvaluationId: entry.id, replacesDecisionId: entry.decisionId },
  });
  return {
    outcome: "replaced",
    agentId: entry.agentId,
    originalDecisionId: entry.decisionId,
    replacementDecisionId: decision.id,
    memoryIds,
    reason: callback.reason,
    run: { ...runBase, refused: false, callback: "completed", decisionId: decision.id },
  };
}
