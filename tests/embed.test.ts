import { describe, expect, it } from "vitest";
import { DemoEmbedder, cosineSimilarity } from "../lib/embed";

describe("DemoEmbedder", () => {
  it("produces normalized vectors of the configured dimension", async () => {
    const embedder = new DemoEmbedder(1024);
    const vector = await embedder.embed("Zenith uses ACCT-8842 for settlements.");
    expect(vector.length).toBe(1024);
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic for identical text", async () => {
    const embedder = new DemoEmbedder(1024);
    const a = await embedder.embed("identical text");
    const b = await embedder.embed("identical text");
    expect(a).toEqual(b);
  });

  it("scores similar text above dissimilar text", async () => {
    const embedder = new DemoEmbedder(1024);
    const target = await embedder.embed("Zenith Systems settlements use account ACCT-8842.");
    const similar = await embedder.embed("Zenith Systems settlements use account ACCT-8842.");
    const different = await embedder.embed("the cat sat on the mat");
    expect(cosineSimilarity(similar, target)).toBeGreaterThan(0.99);
    expect(cosineSimilarity(different, target)).toBeLessThan(0.99);
  });
});
