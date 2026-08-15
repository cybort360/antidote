import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { AntidoteError } from "./errors";
import { embedModelId, embeddingDimensions, env, hasBedrock, isDemo, useBedrockEmbeddings } from "./config";
import { fnv1aHex } from "./hash";

export interface Embedder {
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export class DemoEmbedder implements Embedder {
  constructor(readonly dimension: number) {}

  async embed(text: string): Promise<number[]> {
    return demoVectorSync(text, this.dimension);
  }
}

/**
 * Deterministic bag-of-hashed-tokens embedding: each token hashes into a
 * dimension with a sign. Cosine similarity therefore reflects lexical and
 * structural overlap (shared entities, account codes, phrasing), a real
 * semantic-adjacent signal without any keyword blacklist, and it is stable
 * across runs so demo scenarios are reproducible.
 */
export function demoVectorSync(text: string, dimension: number): number[] {
  const vector = new Array(dimension).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  for (const token of tokens) {
    const hash = parseInt(fnv1aHex(token), 16);
    const index = hash % dimension;
    const sign = (hash >>> 16) & 1 ? 1 : -1;
    vector[index] += sign;
  }
  return normalize(vector);
}

export class BedrockEmbedder implements Embedder {
  private readonly client: BedrockRuntimeClient;

  constructor(
    readonly dimension: number,
    private readonly modelId: string,
  ) {
    this.client = new BedrockRuntimeClient({ region: env().AWS_REGION });
  }

  async embed(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: new TextEncoder().encode(JSON.stringify({ inputText: text, dimensions: this.dimension, normalize: true })),
      contentType: "application/json",
      accept: "application/json",
    });
    try {
      const response = await this.client.send(command);
      const parsed = JSON.parse(new TextDecoder().decode(response.body));
      const embedding = parsed.embedding ?? parsed.embeddings?.[0];
      if (!Array.isArray(embedding) || embedding.length !== this.dimension || typeof embedding[0] !== "number") {
        throw new AntidoteError(502, "EMBEDDING_FAILED", `Embedding model returned an unexpected shape (expected ${this.dimension} floats).`);
      }
      return normalize(embedding);
    } catch (error) {
      if (error instanceof AntidoteError) throw error;
      throw new AntidoteError(502, "EMBEDDING_FAILED", `Embedding request failed: ${(error as Error).message}`);
    }
  }
}

let cached: Embedder | undefined;

export function getEmbedder(): Embedder {
  if (cached) return cached;
  const dimension = embeddingDimensions();
  if (!isDemo() && useBedrockEmbeddings() && !hasBedrock()) {
    throw new AntidoteError(502, "EMBEDDING_PROVIDER_UNCONFIGURED", "EMBEDDING_PROVIDER=bedrock requires AWS_REGION and BEDROCK_MODEL_ID");
  }
  if (!isDemo() && useBedrockEmbeddings()) {
    cached = new BedrockEmbedder(dimension, embedModelId());
  } else {
    cached = new DemoEmbedder(dimension);
  }
  return cached;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}
