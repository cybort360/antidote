import type { AttackMemory, ScreeningEvidence, ScreeningResult, ScreenedCandidate } from "../types";
import { getStore } from "../store";

export type ScreenInput = {
  label: string;
  detail: string;
  content: string;
  embedding: number[];
  sourceUri: string;
};

// Weighted multi-factor risk model with semantic (vector), structural entity
// overlap, source characteristics, and attack-method signal. Not a blacklist:
// each factor is computed against known *revoked* incidents.
export const SCREENING_WEIGHTS = { semantic: 0.45, entity: 0.4, source: 0.1, method: 0.05 } as const;

export function screeningThreshold(): number {
  const parsed = Number(process.env.SCREENING_THRESHOLD);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.45;
}

export function extractEntities(text: string): string[] {
  const entities: string[] = [];
  const vendorPatterns = [
    /^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:uses|is|has|operates|maintains)/,
    /\b(?:to|for|with)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\b/,
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:is an approved|has an established)/,
  ];
  for (const pattern of vendorPatterns) {
    const match = text.match(pattern);
    if (match) {
      entities.push(match[1]);
      break;
    }
  }
  for (const match of text.matchAll(/(ACCT-\d{4,}|\d{4,}-ACCT)/gi)) {
    entities.push(match[1].toUpperCase());
  }
  return [...new Set(entities)];
}

function normEntity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sortedNorm(value: string): string {
  return normEntity(value).split("").sort().join("");
}

function entitiesOverlap(candidate: string[], attack: string[]): number {
  if (!candidate.length || !attack.length) return 0;
  const left = candidate.map(normEntity);
  const right = attack.map(normEntity);
  const sortedRight = right.map(sortedNorm);
  let hits = 0;
  for (const entity of left) {
    if (right.some((r) => r === entity || r.includes(entity) || entity.includes(r)) || sortedRight.some((r) => r === sortedNorm(entity))) {
      hits += 1;
    }
  }
  return hits / Math.max(left.length, right.length);
}

function sourceSignal(attack: AttackMemory, sourceUri: string): boolean {
  const characteristics = attack.sourceCharacteristics ?? {};
  const docType = String(characteristics.docType ?? "");
  if (!docType) return false;
  return sourceUri.toLowerCase().includes(docType.toLowerCase());
}

function methodSignal(attack: AttackMemory, content: string): boolean {
  if (["document-poisoning", "settlement-redirection"].includes(attack.attackMethod ?? "")) {
    return /(ACCT-\d{4,}|\d{4,}-ACCT|ledger code|settlement account|routing number)/i.test(content);
  }
  return false;
}

export async function screenCandidates(candidates: ScreenInput[]): Promise<ScreeningResult> {
  const store = getStore();
  const attacks = await store.listAttackMemories(500);
  if (!attacks.length || !candidates.length) {
    return { candidates: [], blocked: [], trusted: [] };
  }

  const screened = await Promise.all(
    candidates.map(async (candidate) => {
      const evidence: ScreeningEvidence[] = [];
      let score = 0;
      const entities = extractEntities(candidate.content);

      // 1) Semantic: CockroachDB vector search against known incidents.
      const semanticMatches = await store.matchPoisonPatterns(candidate.embedding, 5, 0);
      const best = semanticMatches[0];
      if (best && best.similarity > 0) {
        score += SCREENING_WEIGHTS.semantic * best.similarity;
        evidence.push({
          attackId: best.attack.id,
          family: best.attack.family,
          factor: "semantic",
          similarity: best.similarity,
          detail: `semantic similarity ${best.similarity.toFixed(3)} to ${best.attack.family} incident`,
        });
      }

      // 2) Structural: affected-entity overlap with known incidents.
      let bestEntity: { attack: AttackMemory; overlap: number } | null = null;
      for (const attack of attacks) {
        const overlap = entitiesOverlap(entities, attack.affectedEntities ?? []);
        if (overlap > 0 && (!bestEntity || overlap > bestEntity.overlap)) {
          bestEntity = { attack, overlap };
        }
      }
      if (bestEntity && bestEntity.overlap > 0) {
        score += SCREENING_WEIGHTS.entity * bestEntity.overlap;
        evidence.push({
          attackId: bestEntity.attack.id,
          family: bestEntity.attack.family,
          factor: "entity",
          detail: `entity overlap ${bestEntity.overlap.toFixed(2)} (${entities.join(", ")}) with ${bestEntity.attack.family} incident`,
        });
      }

      // 3) Source characteristics.
      const sourceMatch = attacks.find((attack) => sourceSignal(attack, candidate.sourceUri));
      if (sourceMatch) {
        score += SCREENING_WEIGHTS.source;
        evidence.push({
          attackId: sourceMatch.id,
          family: sourceMatch.family,
          factor: "source",
          detail: `source characteristics match (${String(sourceMatch.sourceCharacteristics?.docType ?? "document")})`,
        });
      }

      // 4) Attack-method signal.
      const methodMatch = attacks.find((attack) => methodSignal(attack, candidate.content));
      if (methodMatch) {
        score += SCREENING_WEIGHTS.method;
        evidence.push({
          attackId: methodMatch.id,
          family: methodMatch.family,
          factor: "method",
          detail: `attack-method signal (${methodMatch.attackMethod})`,
        });
      }

      const threshold = screeningThreshold();
      const riskScore = Math.min(1, Math.round(score * 1000) / 1000);
      const result: ScreenedCandidate = {
        label: candidate.label,
        detail: candidate.detail,
        riskScore,
        threshold,
        blocked: riskScore >= threshold,
        evidence,
      };
      return result;
    }),
  );

  return {
    candidates: screened,
    blocked: screened.filter((c) => c.blocked),
    trusted: screened.filter((c) => !c.blocked),
  };
}
