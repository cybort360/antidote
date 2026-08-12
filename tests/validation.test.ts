import { describe, expect, it } from "vitest";
import { IngestDocumentSchema, LineageQuerySchema, RecordActionSchema, RecordDecisionSchema, RecordDerivedSchema, RetrieveMemoriesSchema, RevocationSchema } from "../lib/validation";

describe("validation", () => {
  it("accepts a valid ingest document", () => {
    const result = IngestDocumentSchema.safeParse({ sourceUri: "s3://b/doc.pdf", content: "Zenith uses ACCT-8842." });
    expect(result.success).toBe(true);
  });

  it("rejects ingest without content", () => {
    const result = IngestDocumentSchema.safeParse({ sourceUri: "s3://b/doc.pdf" });
    expect(result.success).toBe(false);
  });

  it("rejects empty content and oversized sourceUri", () => {
    expect(IngestDocumentSchema.safeParse({ sourceUri: "", content: "x" }).success).toBe(false);
    expect(IngestDocumentSchema.safeParse({ sourceUri: "u".repeat(2049), content: "x" }).success).toBe(false);
  });

  it("bounds retrieval k to 1..50", () => {
    expect(RetrieveMemoriesSchema.parse({ agentId: "a", query: "q" }).k).toBe(5);
    expect(RetrieveMemoriesSchema.safeParse({ agentId: "a", query: "q", k: 0 }).success).toBe(false);
    const tooMany = RetrieveMemoriesSchema.safeParse({ agentId: "a", query: "q", k: 51 });
    expect(tooMany.success).toBe(false);
  });

  it("validates decision memory ids are non-empty", () => {
    expect(RecordDecisionSchema.safeParse({ agentId: "a", memoryIds: [], summary: "s" }).success).toBe(false);
    expect(RecordDecisionSchema.safeParse({ agentId: "a", memoryIds: ["m-1"], summary: "s" }).success).toBe(true);
  });

  it("validates actions require type and decision id", () => {
    expect(RecordActionSchema.safeParse({ decisionId: "d", actionType: "wire" }).success).toBe(true);
    expect(RecordActionSchema.safeParse({ decisionId: "d" }).success).toBe(false);
    expect(RecordActionSchema.safeParse({ actionType: "wire" }).success).toBe(false);
  });

  it("validates derived memories require detail", () => {
    expect(RecordDerivedSchema.safeParse({ decisionId: "d", label: "M-1", detail: "x" }).success).toBe(true);
    expect(RecordDerivedSchema.safeParse({ decisionId: "d", label: "M-1" }).success).toBe(false);
  });

  it("validates revocations and lineage", () => {
    expect(RevocationSchema.parse({ memoryId: "m-184" }).execute).toBe(false);
    expect(RevocationSchema.parse({ memoryId: "m-184", execute: true }).execute).toBe(true);
    expect(LineageQuerySchema.safeParse({ memoryId: "" }).success).toBe(false);
    expect(LineageQuerySchema.parse({ memoryId: "m-184" }).memoryId).toBe("m-184");
  });
});
