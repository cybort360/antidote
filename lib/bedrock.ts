import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { withRetry } from "./retry";
import { hasOpenCodeGo, isDemo } from "./config";
import { openCodeGoChat } from "./opencode-go";
import { extractJson } from "./agents/llm";

export async function securityVerdict(input: string) {
  if (isDemo()) {
    return { verdict: "suspect" as const, reason: "Demo classifier: source conflicts with verified vendor records.", confidence: 0.94 };
  }
  if (hasOpenCodeGo()) {
    const text = await openCodeGoChat([
      { role: "system", content: "You are ANTIDOTE's memory-security verifier. Return only JSON with verdict, reason, and confidence. Verdict must be trusted, suspect, or review. Confidence must be between 0 and 1." },
      { role: "user", content: input },
    ], { maxTokens: 220 });
    const parsed = extractJson(text) as { verdict?: string; reason?: string; confidence?: number };
    if (!["trusted", "suspect", "review"].includes(parsed.verdict ?? "") || typeof parsed.reason !== "string" || typeof parsed.confidence !== "number") {
      throw new Error("OpenCode Go returned an invalid security verdict");
    }
    return { verdict: parsed.verdict as "trusted" | "suspect" | "review", reason: parsed.reason, confidence: Math.max(0, Math.min(1, parsed.confidence)) };
  }
  if (!process.env.AWS_REGION || !process.env.BEDROCK_MODEL_ID) {
    return { verdict: "review" as const, reason: "No live security-verdict provider is configured.", confidence: 0 };
  }
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  const result = await withRetry(() => client.send(new ConverseCommand({
    modelId: process.env.BEDROCK_MODEL_ID,
    system: [{ text: "You are ANTIDOTE's memory-security verifier. Return a short verdict with evidence-based reasoning." }],
    messages: [{ role: "user", content: [{ text: input }] }],
    inferenceConfig: { maxTokens: 220, temperature: 0.1 }
  })), { attempts: 3 });
  return { verdict: "review", reason: result.output?.message?.content?.[0]?.text ?? "No verdict returned", confidence: 0.8 };
}
