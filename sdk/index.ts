export type AntidoteClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
};

export class AntidoteApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "AntidoteApiError";
  }
}

export class AntidoteClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(options: AntidoteClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  ingest(input: { sourceUri: string; content: string; contentType?: string; actor?: string; idempotencyKey?: string }) {
    return this.request<IngestionResult>("/api/ingest", { method: "POST", body: input });
  }

  retrieve(input: { agentId: string; query: string; k?: number; minSimilarity?: number; context?: Record<string, unknown> }) {
    return this.request<RetrievalResult>("/api/retrieve", { method: "POST", body: input });
  }

  recordDecision(input: { agentId: string; memoryIds: string[]; summary: string; detail?: string; context?: Record<string, unknown>; idempotencyKey?: string }) {
    return this.request<DecisionResult>("/api/decisions", { method: "POST", body: input });
  }

  recordAction(decisionId: string, input: { actionType: string; summary?: string; payload?: Record<string, unknown>; externalRef?: string; idempotencyKey?: string }) {
    return this.request<ActionResult>(`/api/decisions/${encodeURIComponent(decisionId)}/actions`, { method: "POST", body: input });
  }

  derive(decisionId: string, input: { label: string; detail: string; idempotencyKey?: string }) {
    return this.request<MemoryResult>(`/api/decisions/${encodeURIComponent(decisionId)}/derived`, { method: "POST", body: input });
  }

  lineage(memoryId: string) {
    return this.request<Record<string, unknown>>(`/api/lineage?memoryId=${encodeURIComponent(memoryId)}`);
  }

  simulateRepair(memoryId: string, input: { reason?: string; actor?: string } = {}) {
    return this.request<RepairSimulation>("/api/revocations", { method: "POST", body: { memoryId, execute: false, ...input } });
  }

  executeRepair(memoryId: string, input: { reason: string; actor: string }) {
    return this.request<RepairResult>("/api/revocations", { method: "POST", body: { memoryId, execute: true, ...input } });
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await this.requestFetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await response.json() as T & { error?: { code?: string; message?: string; details?: unknown } };
    if (!response.ok) throw new AntidoteApiError(response.status, payload.error?.code ?? "HTTP_ERROR", payload.error?.message ?? `ANTIDOTE returned ${response.status}`, payload.error?.details);
    return payload;
  }
}

export type MemoryResult = { id: string; status: string; detail: string };
export type IngestionResult = { jobId: string; memories: MemoryResult[]; created: MemoryResult[]; duplicates: MemoryResult[] };
export type RetrievalResult = { results: { memory: MemoryResult; similarity: number; eventId: string }[]; poisonMatches: unknown[] };
export type DecisionResult = { id: string; memoryIds: string[]; summary: string; status: string };
export type ActionResult = { id: string; decisionId: string; status: string };
export type RepairSimulation = { mode: "simulation"; affected: Record<string, number>; plan: Record<string, unknown> };
export type RepairResult = { mode: "repair"; affected: Record<string, number>; result: { repairId: string; executed: boolean; status: string } };
