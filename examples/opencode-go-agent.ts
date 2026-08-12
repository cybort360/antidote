import { AntidoteClient } from "../sdk";

const goKey = process.env.OPENCODE_GO_API_KEY;
if (!goKey) throw new Error("OPENCODE_GO_API_KEY is required for this example");

const antidote = new AntidoteClient({ baseUrl: process.env.ANTIDOTE_URL, apiKey: process.env.ANTIDOTE_API_KEY });
const recalled = await antidote.retrieve({ agentId: "opencode-go-finance", query: "What action should we take for this payment?", k: 5 });
const evidence = recalled.results.map((result) => `[${result.memory.id}] ${result.memory.detail}`).join("\n");
if (!evidence) throw new Error("No trusted ANTIDOTE evidence returned");

const response = await fetch(`${process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1"}/chat/completions`, {
  method: "POST",
  headers: { authorization: `Bearer ${goKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: process.env.OPENCODE_GO_MODEL ?? "deepseek-v4-flash",
    temperature: 0.1,
    messages: [
      { role: "system", content: "Return JSON with summary and detail. Base the decision only on supplied memory evidence." },
      { role: "user", content: evidence },
    ],
  }),
});
if (!response.ok) throw new Error(`OpenCode Go returned ${response.status}`);
const completion = await response.json() as { choices?: { message?: { content?: string } }[] };
const content = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}") as { summary?: string; detail?: string };
if (!content.summary) throw new Error("The model did not return a decision summary");

const decision = await antidote.recordDecision({ agentId: "opencode-go-finance", memoryIds: recalled.results.map((result) => result.memory.id), summary: content.summary, detail: content.detail });
console.log({ decisionId: decision.id, memoryIds: decision.memoryIds });
