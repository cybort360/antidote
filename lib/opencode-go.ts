import { env } from "./config";
import { withRetry } from "./retry";

export type OpenCodeGoMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function openCodeGoChat(messages: OpenCodeGoMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const response = await withRetry(() => fetch(`${env().OPENCODE_GO_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env().OPENCODE_GO_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env().OPENCODE_GO_MODEL,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 700,
    }),
  }), { attempts: 3 });
  if (!response.ok) throw new Error(`OpenCode Go returned ${response.status}`);
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenCode Go returned an empty completion");
  return text;
}
