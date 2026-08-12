import { z } from "zod";
import { getStore } from "../store";
import { computeBlastRadius, executeRepair } from "../recovery";
import type { RepairPlan, RepairResult } from "../store";
import { requireAgent } from "./registry";
import { beginAgentRun, finishAgentRun } from "./base";
import { structuredCompletion } from "./llm";
import { badRequest } from "../errors";
import type { AgentRunMeta } from "./base";

const VerdictSchema = z.object({
  verdict: z.enum(["trusted", "suspect", "review"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});

export type SecurityResult = AgentRunMeta & {
  kind: "security";
  targetMemoryId: string;
  targetDetail: string;
  verdictId: string;
  verdict: "trusted" | "suspect" | "review";
  confidence: number;
  reason: string;
  contaminationId?: string;
  blastRadius: RepairPlan;
  repair?: { repairId: string; executed: boolean; statuses: Record<string, string> };
};

export type SecurityOptions = {
  runId?: string;
  deterministic?: boolean;
  memoryId?: string;
  repair?: boolean;
};

export async function runSecurity(options: SecurityOptions = {}): Promise<SecurityResult> {
  const agent = requireAgent("security");
  const runId = options.runId ?? `run-${Date.now()}`;
  const { meta, session } = await beginAgentRun(agent, runId, { role: "memory integrity" });
  const store = getStore();

  // 1) Target: the originating memory (or an explicit one).
  let targetMemoryId = options.memoryId;
  if (!targetMemoryId) {
    const candidates = await store.listMemories("memory");
    targetMemoryId = candidates[0]?.id;
  }
  if (!targetMemoryId) throw badRequest("No memory available to verify; run the procurement agent first");
  const target = await store.getMemory(targetMemoryId);
  if (!target || !(target.kind === "memory" || target.kind === "derived")) {
    throw badRequest(`Memory ${targetMemoryId} does not exist`);
  }

  // 2) Verify the fact against known-good records (structured verdict).
  const llm = await structuredCompletion({
    system: agent.systemPrompt,
    user: `Verify this memory fact:\n[${target.id}] ${target.detail}`,
    schema: VerdictSchema,
    deterministic: options.deterministic,
    fallback: () => ({
      verdict: "suspect" as const,
      confidence: 0.94,
      reason: "Demo classifier: source conflicts with verified vendor records.",
    }),
  });
  meta.llmSource = llm.source;

  // 3) Persist the verdict and flag contamination when suspect.
  const verdict = await store.recordSecurityVerdict({
    memoryId: target.id,
    targetText: target.detail,
    verdict: llm.content.verdict,
    confidence: llm.content.confidence,
    reason: llm.content.reason,
    modelId: process.env.BEDROCK_MODEL_ID ?? "deterministic-classifier",
  });
  let contaminationId: string | undefined;
  if (llm.content.verdict === "suspect") {
    const contamination = await store.recordContamination({ memoryId: target.id, verdictId: verdict.id, severity: "high", reason: llm.content.reason, detectedBy: agent.id });
    contaminationId = contamination.id;
  }

  // 4) Compute the causal blast radius from the compromised memory.
  const blastRadius = await computeBlastRadius(target.id);

  // 5) Optionally execute the transactional repair (revoke/quarantine/invalidate/cancel).
  let repair: SecurityResult["repair"];
  if (options.repair) {
    const result: RepairResult = await executeRepair(blastRadius, { actor: agent.id, reason: llm.content.reason });
    const statuses: Record<string, string> = {};
    for (const id of [target.id, ...blastRadius.memoryIds, ...blastRadius.decisionIds, ...blastRadius.actionIds]) {
      const node = await store.getMemory(id);
      if (node) statuses[id] = node.status;
    }
    repair = { repairId: result.repairId, executed: result.executed, statuses };
  }

  return finishAgentRun(meta, {
    kind: "security",
    targetMemoryId: target.id,
    targetDetail: target.detail,
    verdictId: verdict.id,
    verdict: llm.content.verdict,
    confidence: llm.content.confidence,
    reason: llm.content.reason,
    contaminationId,
    blastRadius,
    repair,
  });
}
