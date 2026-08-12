import type { IngestDocumentInput, IngestionResult } from "../types";
import { getStore } from "../store";
import type { PreparedMemory } from "../store";
import { getEmbedder } from "../embed";
import { getExtractor } from "../extract";
import { sha256Hex, shortId } from "../hash";
import { IngestDocumentSchema } from "../validation";
import { AntidoteError } from "../errors";
import { screenCandidates } from "./screen";

export async function ingestDocument(input: IngestDocumentInput): Promise<IngestionResult> {
  const data = IngestDocumentSchema.parse(input);
  const store = getStore();

  if (data.idempotencyKey) {
    const prior = await store.findIngestionByKey(data.idempotencyKey);
    if (prior) return prior;
  }

  const contentHash = await sha256Hex(data.content);
  const jobId = shortId("ing");
  await store.createIngestion({ id: jobId, idempotencyKey: data.idempotencyKey, sourceUri: data.sourceUri, contentHash, actor: data.actor });

  try {
    const candidates = await getExtractor().extractCandidates({ sourceUri: data.sourceUri, content: data.content });
    if (candidates.length === 0) {
      throw new AntidoteError(400, "NO_EXTRACTABLE_CONTENT", "The document contains no extractable memory content.");
    }
    const embedder = getEmbedder();
    const prepared: (PreparedMemory & { embedding: number[] })[] = [];
    for (const candidate of candidates) {
      prepared.push({ ...candidate, contentHash: await sha256Hex(candidate.content), embedding: await embedder.embed(candidate.content) });
    }

    // Second learning loop: compare every candidate semantically and
    // structurally against known revoked incidents BEFORE it can be trusted.
    // High-risk candidates are persisted as quarantined, never trusted.
    const screening = await screenCandidates(
      prepared.map((c) => ({ label: c.label, detail: c.detail, content: c.content, embedding: c.embedding, sourceUri: data.sourceUri })),
    );
    const memories: PreparedMemory[] = prepared.map((candidate, index) => {
      const result = screening.candidates[index];
      if (result?.blocked) {
        return { ...candidate, status: "quarantined", screening: { riskScore: result.riskScore, threshold: result.threshold, blocked: true, evidence: result.evidence } };
      }
      if (result) {
        return { ...candidate, screening: { riskScore: result.riskScore, threshold: result.threshold, blocked: false, evidence: result.evidence } };
      }
      return candidate;
    });

    const result = await store.ingestDocument({ ...data, jobId, contentHash, memories });

    // Immutable source archival (S3 Object Lock) — best effort, live mode only.
    if (process.env.EVIDENCE_BUCKET && process.env.AWS_REGION) {
      try {
        const { archiveSourceDocument } = await import("../evidence");
        const archived = await archiveSourceDocument({ sourceUri: data.sourceUri, content: data.content, contentType: data.contentType, sha256: contentHash });
        if (archived.archived) {
          await store.audit("source.archived", data.actor ?? "pipeline", jobId, { uri: archived.uri });
        }
      } catch (error) {
        console.error(`[antidote] source archival failed for ${data.sourceUri}:`, (error as Error).message);
      }
    }

    return result;
  } catch (error) {
    await store.failIngestion(jobId, error instanceof Error ? error.message : "unknown error");
    throw error;
  }
}
