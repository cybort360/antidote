import { z } from "zod";
import { getStore } from "../store";
import { ingestDocument } from "../pipeline/ingest";
import { recordDecision } from "../pipeline/decision";
import { requireAgent } from "./registry";
import { beginAgentRun, extractVendorFacts, finishAgentRun } from "./base";
import { structuredCompletion } from "./llm";
import type { AgentRunMeta } from "./base";

const DecisionContentSchema = z.object({
  summary: z.string().min(1).max(200),
  detail: z.string().min(1).max(500),
  qualification: z.enum(["approved", "rejected", "review"]),
});

export type ProcurementResult = AgentRunMeta & {
  kind: "procurement";
  sourceId: string;
  sourceUri: string;
  vendor: string;
  account: string;
  memoryIds: string[];
  poisonedMemoryId: string;
  decisionId: string;
  decisionSummary: string;
  decisionDetail: string;
  decisionMemoryIds: string[];
  derivedMemoryId: string;
  derivedDetail: string;
};

export type ProcurementOptions = {
  vendorDocument: string;
  sourceUri?: string;
  runId?: string;
  deterministic?: boolean;
};

export async function runProcurement(options: ProcurementOptions): Promise<ProcurementResult> {
  const agent = requireAgent("procurement");
  const runId = options.runId ?? `run-${Date.now()}`;
  const { meta, session } = await beginAgentRun(agent, runId, { role: "vendor qualification" });
  const store = getStore();

  const vendorFacts = extractVendorFacts(options.vendorDocument);
  const sourceUri = options.sourceUri ?? `vendor-policy-${runId}.pdf`;

  // 1) Ingest the vendor document: a source node + candidate memories with embeddings.
  const ingestion = await ingestDocument({ sourceUri, content: options.vendorDocument, contentType: "text/plain", actor: agent.id });
  const memoryIds = ingestion.created.map((m) => m.id);
  const poisonedMemoryId = memoryIds[0];

  // 2) Decide whether to approve the vendor, citing the ingested facts.
  const llm = await structuredCompletion({
    system: agent.systemPrompt,
    user: `Vendor document ${sourceUri}:\n${options.vendorDocument}`,
    schema: DecisionContentSchema,
    deterministic: options.deterministic,
    fallback: () => ({
      summary: "Vendor approved",
      detail: `${vendorFacts.vendor} approved based on ingested vendor policy.`,
      qualification: "approved" as const,
    }),
  });
  meta.llmSource = llm.source;

  // 3) Record the decision with the exact memory IDs that influenced it.
  const decision = await recordDecision({
    agentId: agent.id,
    memoryIds,
    summary: llm.content.summary,
    detail: llm.content.detail,
    context: { sessionId: session.id, runId, qualification: llm.content.qualification },
  });

  // 4) The approval produces a derived memory (approved supplier), so downstream
  //    agents retrieve information derived from the poisoned fact.
  const derived = await (await import("../pipeline/decision")).recordDerivedMemory({
    decisionId: decision.id,
    label: "Approved supplier",
    detail: `${vendorFacts.vendor} is an approved supplier.`,
    idempotencyKey: `procurement-derived-${runId}`,
  });

  // Resolve the source node id from causal lineage (source → memory).
  const chain = await store.getCausalChain(poisonedMemoryId);
  const sourceId = chain.source?.id ?? `src-${runId}`;

  return finishAgentRun(meta, {
    kind: "procurement",
    sourceId,
    sourceUri,
    vendor: vendorFacts.vendor,
    account: vendorFacts.account,
    memoryIds,
    poisonedMemoryId,
    decisionId: decision.id,
    decisionSummary: decision.summary,
    decisionDetail: decision.detail,
    decisionMemoryIds: decision.memoryIds,
    derivedMemoryId: derived.id,
    derivedDetail: derived.detail,
  });
}
