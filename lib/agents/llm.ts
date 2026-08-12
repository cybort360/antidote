import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { toJSONSchema } from "zod";
import type { ZodType } from "zod";
import { env, hasBedrock, hasOpenCodeGo, isDemo } from "../config";
import { withRetry } from "../retry";
import { logger } from "../logger";
import { openCodeGoChat } from "../opencode-go";

export type LlmSource = "bedrock" | "opencode-go" | "fallback";

export type LlmOutcome<T> = {
  content: T;
  source: LlmSource;
};

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[\[{]/);
  const end = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
  if (start === -1 || end <= start) throw new Error("No JSON found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

function describeSchema<T>(schema: ZodType<T>): string {
  try {
    return JSON.stringify(toJSONSchema(schema));
  } catch {
    return JSON.stringify((schema as unknown as { shape?: unknown }).shape ?? {});
  }
}

export type StructuredCompletionOptions<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  deterministic?: boolean;
  fallback: () => T | Promise<T>;
};

/**
 * Deterministic structured model call for agent decisions.
 * - Live mode: Bedrock Converse returns a JSON object validated against `schema`
 *   (temperature 0.1, one retry, then fallback).
 * - Demo / deterministic mode: skips the network and returns `fallback()`.
 * Returns the content plus the source so the demo can show which path ran.
 */
export async function structuredCompletion<T>(options: StructuredCompletionOptions<T>): Promise<LlmOutcome<T>> {
  const useOpenCodeGo = !options.deterministic && !isDemo() && hasOpenCodeGo();
  const useBedrock = !options.deterministic && !isDemo() && !useOpenCodeGo && hasBedrock();
  if (!useBedrock && !useOpenCodeGo) {
    return { content: await options.fallback(), source: "fallback" };
  }
  const schemaJson = describeSchema(options.schema);
  const system = `${options.system}\n\nRespond with a single JSON object matching this JSON schema exactly:\n${schemaJson}\nDo not include commentary, markdown fences, or preamble.`;
  const attempts = [options.user, `${options.user}\n\nYour previous response was not valid JSON matching the schema. Respond with ONLY the JSON object.`];
  let lastError: unknown;
  for (const message of attempts) {
    try {
      let text = "";
      let source: LlmSource;
      if (useBedrock) {
        const client = new BedrockRuntimeClient({ region: env().AWS_REGION });
        const result = await withRetry(
          () => client.send(new ConverseCommand({
            modelId: env().BEDROCK_MODEL_ID,
            system: [{ text: system }],
            messages: [{ role: "user", content: [{ text: message }] }],
            inferenceConfig: { maxTokens: options.maxTokens ?? 700, temperature: options.temperature ?? 0.1 },
          })),
          { attempts: 3 },
        );
        text = result.output?.message?.content?.[0]?.text ?? "";
        source = "bedrock";
      } else {
        text = await openCodeGoChat(
          [{ role: "system", content: system }, { role: "user", content: message }],
          { temperature: options.temperature, maxTokens: options.maxTokens },
        );
        source = "opencode-go";
      }
      const parsed = extractJson(text);
      const validated = options.schema.safeParse(parsed);
      if (validated.success) return { content: validated.data, source };
      lastError = validated.error;
    } catch (error) {
      lastError = error;
    }
  }
  logger.warn("llm.structured_fallback", { reason: (lastError as Error)?.message ?? "unknown" });
  return { content: await options.fallback(), source: "fallback" };
}
