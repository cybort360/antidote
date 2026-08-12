import { z } from "zod";
import type { AttackMemory, AttackMemoryMatch, ContaminationEvent, SecurityVerdict } from "../types";
import { getStore } from "../store";
import { getEmbedder } from "../embed";
import { getExtractor, assertExtractorHealthy } from "../extract";
import { securityVerdict } from "../bedrock";
import { badRequest } from "../errors";
import { extractEntities } from "./screen";
import { isDemo } from "../config";

const VerdictInputSchema = z.object({
  memoryId: z.string().trim().min(1).max(128).optional(),
  targetText: z.string().trim().min(1).max(8000),
  actor: z.string().trim().max(128).optional(),
});

const AttackInputSchema = z.object({
  pattern: z.string().trim().min(1).max(8000),
  family: z.string().trim().max(128).optional(),
  memoryId: z.string().trim().min(1).max(128).optional(),
  actor: z.string().trim().max(128).optional(),
});

const MatchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  k: z.number().int().min(1).max(20).default(3),
  minSimilarity: z.number().min(0).max(1).optional().default(0.6),
});

export type VerdictInput = z.infer<typeof VerdictInputSchema>;

export async function runSecurityVerdict(input: VerdictInput): Promise<{ verdict: SecurityVerdict; contamination?: ContaminationEvent }> {
  const data = VerdictInputSchema.parse(input);
  const store = getStore();

  let result: Awaited<ReturnType<typeof securityVerdict>>;
  try {
    result = await securityVerdict(data.targetText);
  } catch (error) {
    result = { verdict: "review", reason: (error as Error).message, confidence: 0.5 };
  }

  const verdict = await store.recordSecurityVerdict({
    memoryId: data.memoryId,
    targetText: data.targetText,
    verdict: result.verdict as SecurityVerdict["verdict"],
    confidence: result.confidence,
    reason: result.reason,
    modelId: isDemo() ? "demo-classifier" : process.env.BEDROCK_MODEL_ID ?? (process.env.OPENCODE_GO_API_KEY ? `opencode-go:${process.env.OPENCODE_GO_MODEL ?? "deepseek-v4-flash"}` : "unconfigured"),
  });

  let contamination: ContaminationEvent | undefined;
  if (verdict.verdict === "suspect" && data.memoryId) {
    contamination = await store.recordContamination({ memoryId: data.memoryId, verdictId: verdict.id, severity: "high", reason: result.reason, detectedBy: data.actor ?? "security-verifier" });
  }
  return { verdict, contamination };
}

export async function recordAttackMemory(input: z.infer<typeof AttackInputSchema>): Promise<AttackMemory> {
  const data = AttackInputSchema.parse(input);
  const store = getStore();
  if (data.memoryId) {
    const memory = await store.getMemory(data.memoryId);
    if (!memory || !(memory.kind === "memory" || memory.kind === "derived")) {
      throw badRequest(`Memory ${data.memoryId} does not exist`);
    }
  }
  const embedding = await getEmbedder().embed(data.pattern);
  return store.recordAttackMemory({
    pattern: data.pattern,
    family: data.family ?? "unknown",
    embedding,
    memoryId: data.memoryId,
    actor: data.actor ?? "security-agent",
    affectedEntities: extractEntities(data.pattern),
    attackMethod: detectAttackMethod(data.pattern),
  });
}

/**
 * The second learning loop's trusted incident record: created after Security
 * confirms a poisoning incident and the repair completes. Captures attack
 * family, source characteristics, semantic representation (embedding), affected
 * entities, attack method, the security verdict, the repair outcome, and full
 * provenance — everything future screenings compare against.
 */
export async function recordAttackMemoryFromRepair(options: {
  rootMemoryId: string;
  content: string;
  sourceUri: string;
  revocationId?: string;
  repairId: string;
  actor: string;
  reason?: string;
}): Promise<AttackMemory> {
  const store = getStore();
  const entities = extractEntities(options.content);
  const family = detectFamily(options.content, entities);
  const method = detectAttackMethod(options.content);
  const verdictRecord = (await store.listSecurityVerdicts(200)).find((v) => v.memoryId === options.rootMemoryId);
  const embedding = await getEmbedder().embed(options.content);
  const sourceCharacteristics = {
    docType: /policy/i.test(options.sourceUri) ? "policy" : "document",
    uri: options.sourceUri,
    method,
  };
  const provenance = {
    memoryId: options.rootMemoryId,
    sourceUri: options.sourceUri,
    revocationId: options.revocationId ?? null,
    repairId: options.repairId,
    actor: options.actor,
    reason: options.reason ?? null,
    recordedAt: new Date().toISOString(),
  };
  return store.recordAttackMemory({
    pattern: options.content,
    family,
    embedding,
    memoryId: options.rootMemoryId,
    revocationId: options.revocationId,
    actor: options.actor,
    affectedEntities: entities,
    attackMethod: method,
    verdict: verdictRecord?.verdict ?? "suspect",
    verdictConfidence: verdictRecord?.confidence ?? 0.9,
    verdictReason: verdictRecord?.reason ?? options.reason ?? "confirmed memory poisoning",
    repairId: options.repairId,
    sourceCharacteristics,
    provenance,
  });
}

export function detectFamily(content: string, entities: string[]): string {
  const hasCode = entities.some((entity) => /\d/.test(entity));
  return hasCode && /(settlement|account|payment|transfer|wire|ledger|routing)/i.test(content) ? "settlement-redirection" : "confirmed-poisoning";
}

export function detectAttackMethod(content: string): string {
  return /(ACCT-\d{4,}|\d{4,}-ACCT|ledger code|routing number)/i.test(content) ? "settlement-redirection" : "document-poisoning";
}

export async function matchPoisonPatterns(input: z.input<typeof MatchSchema>): Promise<{ query: string; matches: AttackMemoryMatch[] }> {
  const data = MatchSchema.parse(input);
  const store = getStore();
  const queryEmbedding = await getEmbedder().embed(data.query);
  const matches = await store.matchPoisonPatterns(queryEmbedding, data.k, data.minSimilarity);
  return { query: data.query, matches };
}

export function assertSecurityHealthy(): void {
  assertExtractorHealthy();
}
