import { getStore } from "./store";
import type { RepairPlan, RepairResult } from "./store";
import { badRequest } from "./errors";
import { getEmbedder } from "./embed";
import { recordAttackMemoryFromRepair } from "./pipeline/security";

export type { RepairPlan, RepairResult };

export async function computeBlastRadius(rootMemoryId: string): Promise<RepairPlan> {
  if (!rootMemoryId || !rootMemoryId.trim()) throw badRequest("rootMemoryId is required");
  return getStore().computeBlastRadius(rootMemoryId.trim());
}

export async function executeRepair(
  plan: RepairPlan,
  options: { reason?: string; actor?: string; evidenceUri?: string } = {},
): Promise<RepairResult> {
  if (!plan || !plan.rootMemoryId) throw badRequest("A computed repair plan is required");
  const store = getStore();
  const result = await store.executeRepair({ plan, ...options });

  // Confirmed poisoning becomes a trusted, enriched attack memory (second
  // learning loop): family, entities, method, verdict, repair outcome,
  // Provenance is best effort.
  if (result.executed) {
    try {
      const root = await store.getMemory(plan.rootMemoryId);
      if (root && root.content) {
        await recordAttackMemoryFromRepair({
          rootMemoryId: root.id,
          content: root.content,
          sourceUri: root.sourceUri,
          revocationId: result.revocationId,
          repairId: result.repairId,
          actor: options.actor ?? "security-agent",
          reason: options.reason,
        });
      }
    } catch (error) {
      console.error(`[antidote] attack-memory creation failed for ${plan.rootMemoryId}:`, (error as Error).message);
    }
  }

  return result;
}
