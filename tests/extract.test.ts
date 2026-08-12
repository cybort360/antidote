import { beforeEach, describe, expect, it } from "vitest";
import { chunkContent, ChunkExtractor, parseCandidateJson } from "../lib/extract";

describe("ChunkExtractor", () => {
  it("splits a document into paragraph chunks", async () => {
    const extractor = new ChunkExtractor(40, 20);
    const doc = "First paragraph about Zenith.\n\nSecond paragraph about ACCT-8842.\n\nThird paragraph on settlements.";
    const candidates = await extractor.extractCandidates({ sourceUri: "s3://b/doc.txt", content: doc });
    expect(candidates.length).toBe(3);
    expect(candidates[0].label).toBe("M-1");
    expect(candidates[0].content).toContain("Zenith");
  });

  it("caps the number of candidates", async () => {
    const extractor = new ChunkExtractor(10, 2);
    const candidates = await extractor.extractCandidates({ sourceUri: "s3://b/doc.txt", content: Array.from({ length: 5 }, (_, i) => `para ${i}`).join("\n\n") });
    expect(candidates.length).toBe(2);
  });

  it("handles empty content", async () => {
    const extractor = new ChunkExtractor();
    expect(await extractor.extractCandidates({ sourceUri: "s3://b/doc.txt", content: "   \n  " })).toEqual([]);
  });

  it("splits oversized paragraphs", () => {
    const chunks = chunkContent("a".repeat(500), 100);
    expect(chunks.length).toBe(5);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });
});

describe("parseCandidateJson", () => {
  it("parses fenced JSON", () => {
    const parsed = parseCandidateJson('```json\n[{"label":"M-1","detail":"Zenith uses ACCT-8842.","content":"Zenith uses ACCT-8842."}]\n```');
    expect(parsed).toHaveLength(1);
    expect(parsed![0].detail).toContain("ACCT-8842");
  });

  it("parses bare JSON", () => {
    const parsed = parseCandidateJson('[{"label":"M-1","detail":"d","content":"c"}]');
    expect(parsed).toHaveLength(1);
  });

  it("returns null on invalid shape", () => {
    expect(parseCandidateJson("no json here")).toBeNull();
    expect(parseCandidateJson('[{"detail":"missing keys"}]')).toBeNull();
  });
});
