import type { AttackMemory, ScreenedCandidate, ScreeningMeta, ScreeningResult } from "../types";
import { isDemo } from "../config";
import { useEmptyDemoStore } from "../store";
import { ingestDocument } from "../pipeline/ingest";
import { runZenithScenario } from "./runScenario";
import { SECOND_ATTACK_DOCUMENT } from "./base";

export type AttackReplayResult = {
  status: "quarantined" | "passed";
  document: string;
  priorIncidents: AttackMemory[];
  candidates: (ScreenedCandidate & { memoryId?: string; status?: string })[];
  blocked: (ScreenedCandidate & { memoryId?: string; status?: string })[];
  trusted: (ScreenedCandidate & { memoryId?: string; status?: string })[];
};

/**
 * Second learning loop demo: ensures a confirmed prior incident exists (the
 * repaired Zenith poisoning), then ingests the rewritten Zenith instruction and
 * shows ANTIDOTE recognizing it via semantic + structural screening and
 * quarantining it before any agent can rely on it.
 */
export async function runAttackReplay(options: { fresh?: boolean; document?: string } = {}): Promise<AttackReplayResult> {
  const demo = isDemo();
  if (options.fresh && demo) useEmptyDemoStore();

  const store = await import("../store").then((m) => m.getStore());
  let priorIncidents = await store.listAttackMemories(50);

  // No prior incident yet: establish one by running the full scenario to repair.
  if (!priorIncidents.length) {
    await runZenithScenario({ fresh: true, repair: true, deterministic: demo });
    priorIncidents = await store.listAttackMemories(50);
  }

  const document = options.document ?? SECOND_ATTACK_DOCUMENT;
  const ingestion = await ingestDocument({
    sourceUri: "vendor-policy-attack2.pdf",
    content: document,
    contentType: "text/plain",
    actor: "security-agent",
  });

  const mergeScreening = (meta: ScreeningMeta | undefined, memoryId: string, status: string): ScreenedCandidate & { memoryId: string; status: string } => ({
    label: "",
    detail: "",
    riskScore: meta?.riskScore ?? 0,
    threshold: meta?.threshold ?? 0,
    blocked: meta?.blocked ?? false,
    evidence: meta?.evidence ?? [],
    memoryId,
    status,
  });

  const candidates = ingestion.created.map((memory) => {
    const screening = (memory.metadata.screening ?? undefined) as ScreeningMeta | undefined;
    return mergeScreening(screening, memory.id, memory.status);
  });
  const blocked = candidates.filter((c) => c.blocked);
  const trusted = candidates.filter((c) => !c.blocked);

  return {
    status: blocked.length > 0 ? "quarantined" : "passed",
    document,
    priorIncidents,
    candidates,
    blocked,
    trusted,
  };
}
