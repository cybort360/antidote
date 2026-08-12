import { z } from "zod";

export const IngestDocumentSchema = z.object({
  sourceUri: z.string().trim().min(1).max(2048),
  content: z.string().min(1).max(2_000_000),
  contentType: z.string().trim().max(128).optional(),
  actor: z.string().trim().max(128).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export const RetrieveMemoriesSchema = z.object({
  agentId: z.string().trim().min(1).max(128),
  query: z.string().min(1).max(2000),
  k: z.number().int().min(1).max(50).default(5),
  minSimilarity: z.number().min(0).max(1).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const RecordDecisionSchema = z.object({
  agentId: z.string().trim().min(1).max(128),
  memoryIds: z.array(z.string().trim().min(1)).min(1).max(64),
  summary: z.string().trim().min(1).max(1000),
  detail: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const RecordActionSchema = z.object({
  decisionId: z.string().trim().min(1).max(128),
  actionType: z.string().trim().min(1).max(128),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  summary: z.string().trim().max(1000).optional(),
  externalRef: z.string().trim().max(512).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export const RecordDerivedSchema = z.object({
  decisionId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(256),
  detail: z.string().trim().min(1).max(4000),
  content: z.string().trim().min(1).max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export const RevocationSchema = z.object({
  memoryId: z.string().trim().min(1).max(128),
  execute: z.boolean().default(false),
  reason: z.string().trim().max(2000).optional(),
  actor: z.string().trim().max(128).optional(),
});

export const LineageQuerySchema = z.object({
  memoryId: z.string().trim().min(1).max(128),
});

export const ListRetrievalsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  agentId: z.string().trim().max(128).optional(),
});
