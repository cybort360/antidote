import { z } from "zod";
import { getStore } from "../store";
import { retrieveMemories } from "../pipeline/retrieve";
import { recordDecision, recordDerivedMemory } from "../pipeline/decision";
import { requireAgent } from "./registry";
import { beginAgentRun, extractVendorFacts, finishAgentRun } from "./base";
import { structuredCompletion } from "./llm";
import type { AgentRunMeta } from "./base";

const DecisionContentSchema = z.object({
  summary: z.string().min(1).max(200),
  detail: z.string().min(1).max(500),
});

export type OperationsResult = AgentRunMeta & {
  kind: "operations";
  query: string;
  refused?: boolean;
  refusalReason?: string;
  retrievals: { memoryId: string; similarity: number; eventId: string }[];
  decisionId?: string;
  decisionSummary?: string;
  decisionDetail?: string;
  decisionMemoryIds: string[];
  derivedMemoryId?: string;
  derivedLabel?: string;
  derivedDetail?: string;
};

export type OperationsOptions = {
  runId?: string;
  deterministic?: boolean;
  query?: string;
  vendorDocument?: string;
  freshSession?: boolean;
};

export async function runOperations(options: OperationsOptions = {}): Promise<OperationsResult> {
  const agent = requireAgent("operations");
  const runId = options.runId ?? `run-${Date.now()}`;
  const { meta, session } = await beginAgentRun(agent, runId, { role: "supplier operations" }, options.freshSession);
  const store = getStore();
  const facts = extractVendorFacts(options.vendorDocument ?? "");

  // 1) Retrieve approved-supplier evidence (derived from the procurement decision).
  const query = options.query ?? "approved suppliers";
  const { results } = await retrieveMemories({ agentId: agent.id, query, k: 5, context: { runId } });
  const retrievals = results.map((r) => ({ memoryId: r.memory.id, similarity: r.similarity, eventId: r.eventId }));
  const memoryIds = results.map((r) => r.memory.id);

  if (memoryIds.length === 0) {
    return finishAgentRun(meta, {
      kind: "operations",
      query,
      refused: true,
      refusalReason: "No trusted supplier evidence survived the repair, so the agent did not derive a replacement operational memory.",
      retrievals,
      decisionMemoryIds: [],
    });
  }

  // 2) Decide to record supplier trust based on the retrieved evidence.
  const evidence = results.map((r) => `[${r.memory.id}] ${r.memory.detail}`).join("\n");
  const llm = await structuredCompletion({
    system: agent.systemPrompt,
    user: `Retrieved approved-supplier evidence:\n${evidence || "(no evidence retrieved)"}`,
    schema: DecisionContentSchema,
    deterministic: options.deterministic,
    fallback: () => ({
      summary: "Supplier trust recorded",
      detail: `${facts.vendor === "the vendor" ? "The vendor" : facts.vendor} recorded as a trusted counterparty from approved-supplier evidence.`,
    }),
  });
  meta.llmSource = llm.source;

  // 3) Record the decision and the derived downstream memory it produces.
  const decision = await recordDecision({
    agentId: agent.id,
    memoryIds,
    summary: llm.content.summary,
    detail: llm.content.detail,
    context: { sessionId: session.id, runId },
  });
  const derived = await recordDerivedMemory({
    decisionId: decision.id,
    label: "Trusted counterparty",
    detail: `${facts.vendor === "the vendor" ? "The vendor" : facts.vendor} has an established trusted payment history.`,
    idempotencyKey: `operations-derived-${runId}`,
  });

  return finishAgentRun(meta, {
    kind: "operations",
    query,
    retrievals,
    decisionId: decision.id,
    decisionSummary: decision.summary,
    decisionDetail: decision.detail,
    decisionMemoryIds: decision.memoryIds,
    derivedMemoryId: derived.id,
    derivedLabel: derived.label,
    derivedDetail: derived.detail,
  });
}
