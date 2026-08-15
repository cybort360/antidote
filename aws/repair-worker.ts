/**
 * ANTIDOTE Lambda worker: asynchronous repair and re-evaluation jobs.
 *
 * Event shapes (see aws/template.yaml):
 *   { type: "repair",     memoryId, actor?, reason? }        → compute blast radius,
 *                                                              archive evidence to S3,
 *                                                              transactionally repair.
 *   { type: "reevaluate", limit? }                           → process the re_evaluation
 *                                                              queue (affected agents marked
 *                                                              complete after clean-memory runs).
 *
 * Deploy behind EventBridge/SQS. Idempotent by design: repairs replay via
 * plan-hash, re-evaluation completion is idempotent per row.
 */
import { computeBlastRadius, executeRepair } from "../lib/recovery";
import { archiveEvidence } from "../lib/evidence";
import { getStore } from "../lib/store";
import { logger } from "../lib/logger";
import { withRetry } from "../lib/retry";
import { reevaluateAffectedAgent } from "../lib/agents/reevaluate";

export type RepairEvent = { type: "repair"; memoryId: string; actor?: string; reason?: string };
export type ReevaluateEvent = { type: "reevaluate"; limit?: number };
type ScheduledEvent = { source?: string; "detail-type"?: string };
type SqsEvent = { Records: { messageId: string; body: string }[] };

function isSqsEvent(event: unknown): event is SqsEvent {
  return Boolean(event && typeof event === "object" && Array.isArray((event as SqsEvent).Records));
}

async function handleOne(event: RepairEvent | ReevaluateEvent | ScheduledEvent): Promise<Record<string, unknown>> {
  if (!("type" in event)) return processReevaluations();
  if (event.type === "reevaluate") {
    return processReevaluations({ limit: event.limit });
  }
  if (!event.memoryId) throw new Error("memoryId is required");
  const actor = event.actor ?? "security-agent";
  const reason = event.reason ?? "memory integrity failure";

  logger.info("repair-worker.started", { type: "repair", memoryId: event.memoryId, actor });

  const plan = await withRetry(() => computeBlastRadius(event.memoryId), { attempts: 3 });
  const evidence = await withRetry(
    () =>
      archiveEvidence(`repairs/${event.memoryId}/${Date.now()}.json`, {
        actor,
        reason,
        plan: {
          rootMemoryId: plan.rootMemoryId,
          memories: plan.memoryIds,
          decisions: plan.decisionIds,
          actions: plan.actionIds,
          cancelActions: plan.cancelActionIds,
          reviewActions: plan.reviewActionIds,
          agents: plan.needsReevaluation,
        },
      }),
    { attempts: 3 },
  );
  const result = await withRetry(() => executeRepair(plan, { actor, reason, evidenceUri: evidence.uri }), { attempts: 3 });

  logger.info("repair-worker.completed", { memoryId: event.memoryId, repairId: result.repairId, executed: result.executed, evidenceUri: evidence.uri });
  return { ok: true, evidence, result };
}

export async function handler(event: RepairEvent | ReevaluateEvent | ScheduledEvent | SqsEvent): Promise<Record<string, unknown>> {
  if (!isSqsEvent(event)) return handleOne(event);

  const batchItemFailures: { itemIdentifier: string }[] = [];
  const results: Record<string, unknown>[] = [];
  for (const record of event.Records) {
    try {
      results.push(await handleOne(JSON.parse(record.body) as RepairEvent | ReevaluateEvent));
    } catch (error) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
      logger.error("repair-worker.sqs.failed", { messageId: record.messageId, error: (error as Error).message });
    }
  }
  return { batchItemFailures, results };
}

/**
 * Drains the re-evaluation queue: marks pending re-evaluation cases completed
 * after the affected agents re-derived their decisions from clean memory.
 * Idempotent: completed rows are skipped.
 */
export async function processReevaluations(options: { limit?: number } = {}): Promise<Record<string, unknown>> {
  const store = getStore();
  const limit = options.limit ?? 50;
  const queue = (await store.listReEvaluations(limit)).filter((entry) => ["pending", "failed"].includes(entry.status) && (entry.attemptCount ?? 0) < 3);
  logger.info("repair-worker.reevaluate.started", { pending: queue.length });
  const processed: string[] = [];
  const failed: string[] = [];
  for (const entry of queue) {
    try {
      const running = await store.startReEvaluation(entry.id);
      if (!running) continue;
      const result = await reevaluateAffectedAgent(running);
      const completed = await store.completeReEvaluation(entry.id, result as unknown as Record<string, unknown>, result.replacementDecisionId);
      if (completed) processed.push(completed.id);
    } catch (error) {
      failed.push(entry.id);
      await store.failReEvaluation(entry.id, (error as Error).message);
      logger.error("repair-worker.reevaluate.failed", { id: entry.id, error: (error as Error).message });
    }
  }
  logger.info("repair-worker.reevaluate.completed", { processed: processed.length, failed: failed.length });
  return { ok: true, processed, failed };
}
