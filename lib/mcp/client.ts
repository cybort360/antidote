import { env, hasDatabase, isDemo } from "../config";
import { getStore } from "../store";
import { logger } from "../logger";
import { withRetry } from "../retry";
import { badRequest, upstream } from "../errors";
import { redactValue } from "./redact";
import type { McpCapability, McpOperation } from "../types";

export const MCP_CAPABILITIES: McpCapability[] = ["list_tables", "get_schema", "get_memory_lineage", "get_blast_radius", "get_repair_status"];

export const MCP_AGENT_ID = "a-sec";
export const MCP_AGENT_LABEL = "Security 09 / Forensics";

/**
 * A governed, read-only MCP backend. Implementations must never expose DML.
 * The simulated backend serves the local store (demo); the CockroachDB backend
 * dials CockroachDB Cloud Managed MCP over JSON-RPC (Streamable HTTP) using the
 * narrowly scoped `antidote_forensics` role (see db/roles.sql).
 */
export interface McpBackend {
  readonly provider: string;
  initialize(): Promise<{ name: string; version: string }>;
  call(capability: McpCapability, params: Record<string, unknown>): Promise<unknown>;
}

const TABLES = [
  "memory_nodes", "memory_edges", "ingestion_jobs", "agent_sessions", "retrieval_events", "decision_inputs",
  "actions", "security_verdicts", "contamination_events", "attack_memories", "revocations", "repair_jobs",
  "re_evaluations", "mcp_operations", "audit_events", "schema_migrations",
];

const SCHEMA = [
  { table: "memory_nodes", description: "sources, memories, agents, decisions, actions, derived memories; VECTOR(1024) embeddings; content hashes; statuses; provenance source_id" },
  { table: "memory_edges", description: "causal lineage: created / retrieved / influenced / produced / derived / dependency" },
  { table: "retrieval_events", description: "every agent retrieval with similarity, session, and linked decision" },
  { table: "decision_inputs", description: "which memory IDs influenced each decision" },
  { table: "actions", description: "external actions with status (pending / executing / completed / cancelled / requires_review)" },
  { table: "security_verdicts", description: "immutable memory-security verdicts from Bedrock / operator" },
  { table: "contamination_events", description: "why a memory became suspect / revoked" },
  { table: "attack_memories", description: "known poison patterns with VECTOR embeddings and affected entities" },
  { table: "revocations", description: "immutable revocation records with evidence URIs" },
  { table: "repair_jobs", description: "transactional repairs, plan-hash idempotent" },
  { table: "re_evaluations", description: "affected agents enqueued for clean-memory re-evaluation" },
  { table: "mcp_operations", description: "governed forensic MCP call log (this trace)" },
  { table: "audit_events", description: "security and operator audit trail" },
];

export class SimulatedMcpBackend implements McpBackend {
  readonly provider = "simulated-local-store";

  async initialize(): Promise<{ name: string; version: string }> {
    return { name: "antidote-simulated-mcp", version: "1.0.0" };
  }

  async call(capability: McpCapability, params: Record<string, unknown>): Promise<unknown> {
    const store = getStore();
    switch (capability) {
      case "list_tables": {
        const counts: Record<string, number> = {};
        const memories = await store.listMemories();
        counts.memory_nodes = memories.length;
        counts.attack_memories = (await store.listAttackMemories(1000)).length;
        counts.re_evaluations = (await store.listReEvaluations(1000)).length;
        counts.repair_jobs = (await store.listRepairJobs(1000)).length;
        counts.mcp_operations = (await store.listMcpOperations(1000)).length;
        return { tables: TABLES, rowCounts: counts };
      }
      case "get_schema":
        return { schema: SCHEMA };
      case "get_memory_lineage": {
        const memoryId = String(params.memoryId ?? "");
        if (!memoryId) throw badRequest("memoryId is required for get_memory_lineage");
        const chain = await store.getCausalChain(memoryId);
        return {
          rootMemoryId: memoryId,
          source: chain.source ? { id: chain.source.id, label: chain.source.label, status: chain.source.status } : null,
          memory: { id: chain.memory.id, status: chain.memory.status },
          retrievals: chain.retrievals.map((r) => ({ id: r.id, agentId: r.agentId, similarity: r.similarity })),
          decisions: chain.decisions.map((d) => ({ id: d.id, agentId: d.agentId, memoryInputs: d.memoryIds, status: d.status })),
          actions: chain.actions.map((a) => ({ id: a.id, decisionId: a.decisionId, status: a.status })),
          derivedMemories: chain.derived.map((m) => ({ id: m.id, status: m.status })),
          nodeCount: chain.nodes.length,
        };
      }
      case "get_blast_radius": {
        const memoryId = String(params.memoryId ?? "");
        if (!memoryId) throw badRequest("memoryId is required for get_blast_radius");
        const plan = await store.computeBlastRadius(memoryId);
        return {
          rootMemoryId: memoryId,
          memories: plan.memoryIds.length,
          derivedMemories: plan.derivedMemoryIds.length,
          decisions: plan.decisionIds,
          actionsToCancel: plan.cancelActionIds,
          actionsRequiringReview: plan.reviewActionIds,
          agents: plan.needsReevaluation,
          retrievals: plan.retrievalEventIds.length,
          reevaluations: plan.reevaluations.map((r) => r.agentId),
        };
      }
      case "get_repair_status": {
        const jobs = await store.listRepairJobs(50);
        const reevaluations = await store.listReEvaluations(50);
        return {
          repairJobs: jobs.map((j) => ({ id: j.id, rootMemoryId: j.rootMemoryId, status: j.status, actor: j.actor, completedAt: j.completedAt })),
          reevaluations: reevaluations.map((r) => ({ id: r.id, agentId: r.agentId, status: r.status })),
          pendingReevaluations: reevaluations.filter((r) => r.status === "pending").length,
        };
      }
      default:
        throw badRequest(`Unknown capability: ${String(capability)}`);
    }
  }
}

export class CockroachMcpBackend implements McpBackend {
  readonly provider = "cockroachdb-cloud-managed-mcp";

  private readonly url: string;
  private readonly apiKey: string | undefined;
  private nextId = 1;

  constructor(url: string, apiKey?: string) {
    this.url = url;
    this.apiKey = apiKey;
  }

  async initialize(): Promise<{ name: string; version: string }> {
    const response = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "antidote", version: "0.1.0" },
    });
    await this.request("notifications/initialized", {});
    const info = (response as { serverInfo?: { name?: string; version?: string } }).serverInfo ?? {};
    return { name: info.name ?? "cockroachdb", version: info.version ?? "unknown" };
  }

  async call(capability: McpCapability, params: Record<string, unknown>): Promise<unknown> {
    const response = await this.request("tools/call", { name: capability, arguments: params });
    const content = ((response as { content?: { type?: string; text?: string }[] }).content ?? []).map((block) => block.text ?? "").join("\n");
    if (!content) return { content: "no output" };
    try {
      return JSON.parse(content);
    } catch {
      return { content };
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await withRetry(
        () =>
          fetch(this.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
            signal: controller.signal,
          }),
        { attempts: 3 },
      );
      if (!response.ok) {
        throw upstream(`MCP endpoint returned ${response.status}`, { status: response.status });
      }
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();
      const payload = contentType.includes("text/event-stream") ? parseSsePayload(text) : JSON.parse(text);
      if (payload.error) throw upstream(`MCP ${method} failed`, { error: payload.error });
      return payload.result ?? payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseSsePayload(text: string): { result?: unknown; error?: unknown } {
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      const value = line.slice(5).trim();
      if (value) return JSON.parse(value);
    }
  }
  throw new Error("Empty MCP SSE stream");
}

let cached: McpBackend | undefined;

export function getMcpBackend(): McpBackend {
  if (cached) return cached;
  if (!isDemo() && env().COCKROACH_MCP_URL) {
    const url = env().COCKROACH_MCP_URL as string;
    cached = new CockroachMcpBackend(url, env().COCKROACH_MCP_API_KEY);
  } else {
    cached = new SimulatedMcpBackend();
  }
  return cached;
}

export function resetMcpBackend(): void {
  cached = undefined;
}

/**
 * Executes a governed forensic MCP operation: whitelisted capability, redacted
 * params/result, full trace recording. Read-only by construction.
 */
export async function runMcpOperation(input: { agentId?: string; capability: McpCapability; params?: Record<string, unknown> }): Promise<McpOperation> {
  const capability = input.capability;
  if (!MCP_CAPABILITIES.includes(capability)) {
    throw badRequest(`Unknown capability: ${String(capability)}`);
  }
  const agentId = input.agentId ?? MCP_AGENT_ID;
  const params = redactValue(input.params ?? {}) as Record<string, unknown>;
  const backend = getMcpBackend();
  const startedAt = Date.now();
  try {
    await backend.initialize();
    const result = await backend.call(capability, params);
    const operation = await getStore().recordMcpOperation({
      agentId,
      capability,
      params,
      status: "completed",
      durationMs: Date.now() - startedAt,
      result: redactValue(result),
    });
    logger.info("mcp.operation.completed", { agentId, capability, durationMs: operation.durationMs, provider: backend.provider });
    return operation;
  } catch (error) {
    const operation = await getStore().recordMcpOperation({
      agentId,
      capability,
      params,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: (error as Error).message,
    });
    logger.error("mcp.operation.failed", { agentId, capability, error: (error as Error).message, provider: backend.provider });
    return operation;
  }
}

export function assertMcpHealthy(): void {
  if (!isDemo() && hasDatabase() && !env().COCKROACH_MCP_URL) {
    logger.warn("mcp.unconfigured", { detail: "COCKROACH_MCP_URL not set; forensic trace will use simulated output" });
  }
}
