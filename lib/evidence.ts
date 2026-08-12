import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { logger } from "./logger";
import { withRetry } from "./retry";
import { sha256Hex } from "./hash";
import { createEvidenceProvenance, type EvidenceProvenance } from "./provenance";

let client: S3Client | undefined;

function s3(): S3Client {
  if (!client) client = new S3Client({ region: process.env.AWS_REGION });
  return client;
}

export async function archiveEvidence(key: string, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  const provenance = createEvidenceProvenance({
    artifactType: "repair",
    digest: await sha256Hex(body),
    secret: process.env.EVIDENCE_SIGNING_SECRET,
  });
  const bucket = process.env.EVIDENCE_BUCKET;
  if (!bucket || !process.env.AWS_REGION) return { archived: false, uri: `demo://evidence/${key}`, provenance };
  try {
    await withRetry(() => s3().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      // Versioned + Object-Locked bucket: evidence is immutable and cannot be
      // overwritten or deleted (see aws/template.yaml).
      Metadata: provenanceMetadata(provenance),
    })), { attempts: 4 });
    logger.info("evidence.archived", { uri: `s3://${bucket}/${key}` });
    return { archived: true, uri: `s3://${bucket}/${key}`, provenance };
  } catch (error) {
    logger.error("evidence.archive_failed", { key, error: (error as Error).message });
    return { archived: false, uri: `demo://evidence/${key}`, provenance };
  }
}

export async function archiveSourceDocument(input: { sourceUri: string; content: string; contentType?: string; sha256?: string }) {
  const bucket = process.env.EVIDENCE_BUCKET;
  const digest = input.sha256 ?? (await sha256Hex(input.content));
  const provenance = createEvidenceProvenance({ artifactType: "source", digest, secret: process.env.EVIDENCE_SIGNING_SECRET });
  if (!bucket || !process.env.AWS_REGION) return { archived: false, uri: `demo://sources/${input.sourceUri}`, provenance };
  const key = `sources/${digest.slice(0, 16)}/${input.sourceUri.split("/").pop() ?? "source.txt"}`;
  try {
    await withRetry(() => s3().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.content,
      ContentType: input.contentType ?? "text/plain",
      Metadata: provenanceMetadata(provenance),
    })), { attempts: 4 });
    logger.info("evidence.source_archived", { uri: `s3://${bucket}/${key}`, digest });
    return { archived: true, uri: `s3://${bucket}/${key}`, provenance };
  } catch (error) {
    logger.error("evidence.source_archive_failed", { error: (error as Error).message });
    return { archived: false, uri: `demo://sources/${input.sourceUri}`, provenance };
  }
}

function provenanceMetadata(provenance: EvidenceProvenance): Record<string, string> {
  return {
    "antidote-artifact": provenance.artifactType,
    "antidote-immutable": "true",
    "antidote-digest": provenance.digest,
    "antidote-digest-algorithm": provenance.digestAlgorithm,
    ...(provenance.signature ? {
      "antidote-signature": provenance.signature,
      "antidote-signature-algorithm": provenance.signatureAlgorithm!,
    } : {}),
  };
}
