import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { ExtractedCandidate } from "./types";
import { chunkSize, env, hasBedrock, hasOpenCodeGo, isDemo } from "./config";
import { AntidoteError } from "./errors";
import { openCodeGoChat } from "./opencode-go";

export interface MemoryExtractor {
  extractCandidates(input: { sourceUri: string; content: string }): Promise<ExtractedCandidate[]>;
}

const CandidateArraySchema = z.array(
  z.object({ label: z.string().min(1).max(256), detail: z.string().min(1).max(2000), content: z.string().min(1).max(2000) }),
).min(1).max(20);

export class ChunkExtractor implements MemoryExtractor {
  private readonly limit: number;
  private readonly max: number;

  constructor(limit = 2000, max = 20) {
    this.limit = limit;
    this.max = max;
  }

  async extractCandidates(_input: { sourceUri: string; content: string }): Promise<ExtractedCandidate[]> {
    return chunkContent(_input.content, this.limit).slice(0, this.max).map((chunk, i) => ({
      label: `M-${i + 1}`,
      detail: chunk,
      content: chunk,
    }));
  }
}

export function chunkContent(content: string, limit = chunkSize()): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < trimmed.length; i += limit) {
        chunks.push(trimmed.slice(i, i + limit));
      }
      continue;
    }
    if ((current + "\n\n" + trimmed).length > limit && current) {
      chunks.push(current);
      current = trimmed;
    } else {
      current = current ? current + "\n\n" + trimmed : trimmed;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export class BedrockExtractor implements MemoryExtractor {
  private readonly client: BedrockRuntimeClient;
  private readonly fallback: ChunkExtractor;

  constructor() {
    this.client = new BedrockRuntimeClient({ region: env().AWS_REGION });
    this.fallback = new ChunkExtractor();
  }

  async extractCandidates(input: { sourceUri: string; content: string }): Promise<ExtractedCandidate[]> {
    const system = [
      { text: "You are ANTIDOTE's memory-extraction pipeline. Extract discrete, factual candidate memories from the supplied document. Output ONLY a JSON array of objects with keys \"label\", \"detail\", and \"content\". Each candidate must be a self-contained factual statement. Limit to 8 candidates. Do not include commentary, markdown fences, or preamble." },
    ];
    const user = `source: ${input.sourceUri}\n\ndocument:\n${input.content.slice(0, 8000)}`;
    try {
      const result = await this.client.send(new ConverseCommand({
        modelId: env().BEDROCK_MODEL_ID,
        system,
        messages: [{ role: "user", content: [{ text: user }] }],
        inferenceConfig: { maxTokens: 1200, temperature: 0.1 },
      }));
      const text = result.output?.message?.content?.[0]?.text ?? "";
      const parsed = parseCandidateJson(text);
      if (parsed) return parsed;
      return this.fallback.extractCandidates(input);
    } catch {
      return this.fallback.extractCandidates(input);
    }
  }
}

export class OpenCodeGoExtractor implements MemoryExtractor {
  private readonly fallback = new ChunkExtractor();

  async extractCandidates(input: { sourceUri: string; content: string }): Promise<ExtractedCandidate[]> {
    try {
      const text = await openCodeGoChat([
        {
          role: "system",
          content: "You are ANTIDOTE's memory-extraction pipeline. Extract discrete factual candidate memories. Return only a JSON array of objects with label, detail, and content. Limit the output to 8 candidates.",
        },
        { role: "user", content: `source: ${input.sourceUri}\n\ndocument:\n${input.content.slice(0, 8000)}` },
      ], { maxTokens: 1200 });
      return parseCandidateJson(text) ?? this.fallback.extractCandidates(input);
    } catch {
      return this.fallback.extractCandidates(input);
    }
  }
}

export function parseCandidateJson(text: string): ExtractedCandidate[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = CandidateArraySchema.parse(JSON.parse(candidate.slice(start, end + 1)));
    return parsed;
  } catch {
    return null;
  }
}

let cached: MemoryExtractor | undefined;

export function getExtractor(): MemoryExtractor {
  if (cached) return cached;
  if (!isDemo() && hasOpenCodeGo()) {
    cached = new OpenCodeGoExtractor();
  } else if (!isDemo() && hasBedrock()) {
    cached = new BedrockExtractor();
  } else {
    cached = new ChunkExtractor();
  }
  return cached;
}

export function assertExtractorHealthy(): void {
  if (!isDemo() && !hasBedrock() && !hasOpenCodeGo()) {
    throw new AntidoteError(502, "MODEL_UNCONFIGURED", "Live mode requires Bedrock or OpenCode Go for memory extraction.");
  }
}
