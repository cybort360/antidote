import type {
  ActionRecord,
  AgentSession,
  AttackMemory,
  AttackMemoryMatch,
  CausalChain,
  ContaminationEvent,
  DecisionRecord,
  Dependency,
  DependencyQuery,
  EdgeRelation,
  IngestDocumentInput,
  IngestionResult,
  IngestionStatus,
  MemoryRecord,
  MemoryEdge,
  NodeKind,
  NodeStatus,
  RecordActionInput,
  RecordDecisionInput,
  RecordDerivedInput,
  RetrievedMemory,
  RetrievalEvent,
  RevocationInput,
  RevocationRecord,
  ReEvaluation,
  McpCapability,
  McpOperation,
  RepairJob,
  AuditEvent,
  Scenario,
  ScreeningMeta,
  SearchMemoriesInput,
  SecurityVerdict,
  SecurityVerdictKind,
} from "./types";
import { embeddingDimensions, hasDatabase, isDemo } from "./config";
import { badRequest, conflict } from "./errors";
import { fnv1aHex, shortId } from "./hash";
import { cosineSimilarity, demoVectorSync } from "./embed";

export type PreparedMemory = {
  label: string;
  detail: string;
  content: string;
  contentHash: string;
  embedding: number[];
  status?: NodeStatus;
  screening?: ScreeningMeta;
};

export type IngestionJobRecord = {
  id: string;
  sourceUri: string;
  status: IngestionStatus;
  idempotencyKey?: string;
  contentHash: string;
  result?: IngestionResult;
  error?: string;
  createdAt: string;
};

export type RepairPlanNode = {
  id: string;
  kind: NodeKind;
  status: NodeStatus;
  depth: number;
};

export type RepairPlanEdge = {
  from: string;
  to: string;
  relation: EdgeRelation;
};

export type PlanEvidence = {
  id: string;
  memoryId: string;
  uri?: string;
};

export type PlanReevaluation = {
  agentId: string;
  decisionId?: string;
  reason: string;
};

export type RepairPlan = {
  rootMemoryId: string;
  memoryIds: string[];
  derivedMemoryIds: string[];
  decisionIds: string[];
  actionIds: string[];
  cancelActionIds: string[];
  reviewActionIds: string[];
  needsReevaluation: string[];
  retrievalEventIds: string[];
  evidence: PlanEvidence[];
  reevaluations: PlanReevaluation[];
  graph: { nodes: RepairPlanNode[]; edges: RepairPlanEdge[] };
};

export type RepairResult = {
  repairId: string;
  status: "completed";
  executed: boolean;
  rootMemoryId: string;
  memoryIds: string[];
  derivedMemoryIds: string[];
  decisionIds: string[];
  actionIds: string[];
  cancelActionIds: string[];
  reviewActionIds: string[];
  needsReevaluation: string[];
  retrievalEventIds: string[];
  evidence: PlanEvidence[];
  reevaluations: PlanReevaluation[];
  reEvaluationIds: string[];
  revocationId?: string;
  repairedAt: string;
};

export function planHashOf(plan: RepairPlan): string {
  const sort = (ids: string[]) => [...ids].sort();
  const canonical = JSON.stringify({
    rootMemoryId: plan.rootMemoryId,
    memoryIds: sort(plan.memoryIds),
    derivedMemoryIds: sort(plan.derivedMemoryIds),
    decisionIds: sort(plan.decisionIds),
    actionIds: sort(plan.actionIds),
    cancelActionIds: sort(plan.cancelActionIds),
    reviewActionIds: sort(plan.reviewActionIds),
    needsReevaluation: sort(plan.needsReevaluation),
    retrievalEventIds: sort(plan.retrievalEventIds),
  });
  return fnv1aHex(canonical);
}

export type ExecuteRepairInput = {
  plan: RepairPlan;
  reason?: string;
  actor?: string;
  evidenceUri?: string;
};

export type RecordVerdictInput = {
  memoryId?: string;
  targetText: string;
  verdict: SecurityVerdictKind;
  confidence: number;
  reason?: string;
  modelId?: string;
  payload?: Record<string, unknown>;
};

export type RecordContaminationInput = {
  memoryId: string;
  verdictId?: string;
  severity?: ContaminationEvent["severity"];
  reason?: string;
  detectedBy: string;
};

export type RecordAttackInput = {
  pattern: string;
  family?: string;
  embedding: number[];
  memoryId?: string;
  revocationId?: string;
  actor: string;
  affectedEntities?: string[];
  sourceCharacteristics?: Record<string, unknown>;
  attackMethod?: string;
  verdict?: SecurityVerdictKind;
  verdictConfidence?: number;
  verdictReason?: string;
  repairId?: string;
  provenance?: Record<string, unknown>;
};

export const BLAST_RELATIONS: EdgeRelation[] = ["retrieved", "influenced", "produced", "derived"];
// 'created' is only traversed when the root itself is a source node, so a
// revoked source flows into the memories it created.
const BLAST_RELATIONS_WITH_SOURCE: EdgeRelation[] = [...BLAST_RELATIONS, "created"];

export interface MemoryStore {
  ingestDocument(input: IngestDocumentInput & { jobId: string; contentHash: string; memories: PreparedMemory[]; contentType?: string; actor?: string }): Promise<IngestionResult>;
  findIngestionByKey(idempotencyKey: string): Promise<IngestionResult | null>;
  createIngestion(input: { id: string; idempotencyKey?: string; sourceUri: string; contentHash: string; actor?: string }): Promise<IngestionJobRecord>;
  failIngestion(id: string, error: string): Promise<void>;
  getIngestion(id: string): Promise<IngestionJobRecord | null>;
  listIngestions(limit?: number): Promise<IngestionJobRecord[]>;

  getMemory(id: string): Promise<MemoryRecord | null>;
  listMemories(kind?: NodeKind, status?: NodeStatus): Promise<MemoryRecord[]>;
  searchMemories(input: SearchMemoriesInput): Promise<RetrievedMemory[]>;
  listRetrievalEvents(limit: number, agentId?: string): Promise<RetrievalEvent[]>;

  recordDecision(input: RecordDecisionInput): Promise<DecisionRecord>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  recordAction(input: RecordActionInput): Promise<ActionRecord>;
  getAction(id: string): Promise<ActionRecord | null>;
  recordDerivedMemory(input: RecordDerivedInput & { embedding: number[] }): Promise<MemoryRecord>;

  getCausalChain(memoryId: string): Promise<CausalChain>;
  getScenario(): Promise<Scenario>;
  computeBlastRadius(rootMemoryId: string): Promise<RepairPlan>;
  executeRepair(input: ExecuteRepairInput): Promise<RepairResult>;
  recordRevocation(input: RevocationInput): Promise<RevocationRecord>;
  audit(eventType: string, actor: string, objectId: string | undefined, payload: Record<string, unknown>): Promise<void>;

  getOrCreateSession(agentId: string, metadata?: Record<string, unknown>): Promise<AgentSession>;
  startFreshSession(agentId: string, metadata?: Record<string, unknown>): Promise<AgentSession>;
  listSessions(limit?: number): Promise<AgentSession[]>;
  recordSecurityVerdict(input: RecordVerdictInput): Promise<SecurityVerdict>;
  listSecurityVerdicts(limit?: number): Promise<SecurityVerdict[]>;
  recordContamination(input: RecordContaminationInput): Promise<ContaminationEvent>;
  listContaminationEvents(limit?: number): Promise<ContaminationEvent[]>;
  recordAttackMemory(input: RecordAttackInput): Promise<AttackMemory>;
  listAttackMemories(limit?: number): Promise<AttackMemory[]>;
  matchPoisonPatterns(queryEmbedding: number[], k?: number, minSimilarity?: number): Promise<AttackMemoryMatch[]>;
  getDependencies(input: DependencyQuery): Promise<Dependency[]>;
  listReEvaluations(limit?: number): Promise<ReEvaluation[]>;
  startReEvaluation(id: string): Promise<ReEvaluation | null>;
  completeReEvaluation(id: string, result?: Record<string, unknown>, replacementDecisionId?: string): Promise<ReEvaluation | null>;
  failReEvaluation(id: string, error: string): Promise<ReEvaluation | null>;
  listRepairJobs(limit?: number): Promise<RepairJob[]>;
  recordMcpOperation(input: { agentId: string; capability: McpCapability; params: Record<string, unknown>; status: "completed" | "failed"; durationMs: number; result?: unknown; error?: string }): Promise<McpOperation>;
  listMcpOperations(limit?: number, agentId?: string): Promise<McpOperation[]>;
  listAuditEvents(limit?: number): Promise<AuditEvent[]>;
}

export function isMemoryKind(kind: NodeKind): boolean {
  return kind === "memory" || kind === "derived";
}

export function isRevokedStatus(status: NodeStatus): boolean {
  return ["revoked", "quarantined", "invalidated", "cancelled", "repaired", "requires_review"].includes(status);
}

const seedLayout: Record<string, { x: number; y: number }> = {
  "src-17": { x: 70, y: 220 },
  "m-184": { x: 250, y: 220 },
  "a-proc": { x: 430, y: 90 },
  "d-441": { x: 610, y: 90 },
  "m-211": { x: 790, y: 90 },
  "a-fin": { x: 430, y: 220 },
  "d-452": { x: 610, y: 220 },
  "act-91": { x: 790, y: 220 },
  "a-ops": { x: 430, y: 350 },
  "m-229": { x: 610, y: 350 },
};

const seedDetails: Record<string, string> = {
  "src-17": "Compromised procurement policy uploaded from a trusted workspace.",
  "m-184": "Zenith Systems settlements use account ACCT-8842.",
  "a-proc": "Autonomous vendor qualification agent.",
  "d-441": "Zenith Systems marked approved based on M-184.",
  "m-211": "Zenith Systems is an approved supplier.",
  "a-fin": "Payment preparation agent.",
  "d-452": "$24,000 settlement prepared using ACCT-8842.",
  "act-91": "External transfer pending final settlement window.",
  "a-ops": "Supplier operations agent.",
  "m-229": "Zenith has an established trusted payment history.",
};

function seedMemory(id: string, kind: NodeKind, label: string, status: NodeStatus, trust: number, sourceUri: string): MemoryRecord {
  return {
    id,
    kind,
    label,
    detail: seedDetails[id] ?? label,
    status,
    trust,
    content: seedDetails[id] ?? label,
    contentHash: fnv1aHex(id),
    sourceUri,
    metadata: {},
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

function seedMemories(): MemoryRecord[] {
  return [
    seedMemory("src-17", "source", "vendor-policy.pdf", "suspect", 0.34, "s3://antidote-evidence/vendor-policy.pdf"),
    seedMemory("m-184", "memory", "M-184", "suspect", 0.61, "s3://antidote-evidence/vendor-policy.pdf"),
    seedMemory("a-proc", "agent", "Procurement 03", "trusted", 0.93, "urn:antidote:agent"),
    seedMemory("d-441", "decision", "Vendor approved", "suspect", 0.58, "urn:antidote:decision"),
    seedMemory("m-211", "derived", "M-211", "suspect", 0.56, "urn:antidote:decision"),
    seedMemory("a-fin", "agent", "Finance 07", "trusted", 0.95, "urn:antidote:agent"),
    seedMemory("d-452", "decision", "Payment prepared", "suspect", 0.6, "urn:antidote:decision"),
    seedMemory("act-91", "action", "$24k transfer", "suspect", 0.6, "urn:antidote:decision"),
    seedMemory("a-ops", "agent", "Operations 04", "trusted", 0.92, "urn:antidote:agent"),
    seedMemory("m-229", "derived", "M-229", "suspect", 0.52, "urn:antidote:decision"),
  ];
}

const seedEdges: { from: string; to: string; relation: EdgeRelation }[] = [
  { from: "src-17", to: "m-184", relation: "created" },
  { from: "m-184", to: "a-proc", relation: "retrieved" },
  { from: "a-proc", to: "d-441", relation: "influenced" },
  { from: "d-441", to: "m-211", relation: "produced" },
  { from: "m-184", to: "a-fin", relation: "retrieved" },
  { from: "a-fin", to: "d-452", relation: "influenced" },
  { from: "d-452", to: "act-91", relation: "produced" },
  { from: "m-211", to: "a-ops", relation: "retrieved" },
  { from: "a-ops", to: "m-229", relation: "derived" },
];

export class InMemoryStore implements MemoryStore {
  private nodes = new Map<string, MemoryRecord>();
  private edges: MemoryEdge[] = [];
  private retrievals: RetrievalEvent[] = [];
  private decisions = new Map<string, DecisionRecord>();
  private actions = new Map<string, ActionRecord>();
  private revocations: RevocationRecord[] = [];
  private jobs = new Map<string, IngestionJobRecord>();
  private audits: { id: string; eventType: string; actor: string; objectId?: string; payload: Record<string, unknown>; createdAt: string }[] = [];
  private repairs: { id: string; rootMemoryId: string; status: string; planHash?: string; revocationId?: string; reEvaluationIds?: string[]; createdAt: string }[] = [];
  private sessions = new Map<string, AgentSession>();
  private verdicts: SecurityVerdict[] = [];
  private contaminations: ContaminationEvent[] = [];
  private attacks = new Map<string, AttackMemory>();
  private reEvaluations: ReEvaluation[] = [];
  private repairChain: Promise<unknown> = Promise.resolve();
  private mcpOperations: McpOperation[] = [];
  private edgeCounter = 100;

  constructor(seed = true) {
    if (!seed) return;
    for (const node of seedMemories()) this.nodes.set(node.id, node);
    for (const edge of seedEdges) this.edges.push({ id: `seed-${this.edgeCounter++}`, ...edge });
    this.retrievals = [
      { id: "rev-1", agentId: "a-proc", memoryId: "m-184", similarity: 0.91, queryText: "settlement account for Zenith", sessionId: "sess-proc", context: {}, createdAt: "2026-07-01T00:01:00.000Z" },
      { id: "rev-2", agentId: "a-fin", memoryId: "m-184", similarity: 0.88, queryText: "payment routing for settlements", sessionId: "sess-fin", context: {}, createdAt: "2026-07-01T00:02:00.000Z" },
      { id: "rev-3", agentId: "a-ops", memoryId: "m-211", similarity: 0.9, queryText: "approved suppliers", sessionId: "sess-ops", context: {}, createdAt: "2026-07-01T00:03:00.000Z" },
    ];
    this.sessions.set("sess-proc", { id: "sess-proc", agentId: "a-proc", status: "active", metadata: {}, startedAt: "2026-07-01T00:00:30.000Z" });
    this.sessions.set("sess-fin", { id: "sess-fin", agentId: "a-fin", status: "active", metadata: {}, startedAt: "2026-07-01T00:00:45.000Z" });
    this.sessions.set("sess-ops", { id: "sess-ops", agentId: "a-ops", status: "active", metadata: {}, startedAt: "2026-07-01T00:01:15.000Z" });
    this.decisions.set("d-441", { id: "d-441", agentId: "a-proc", memoryIds: ["m-184"], summary: "Vendor approved", detail: seedDetails["d-441"], status: "suspect", createdAt: "2026-07-01T00:01:30.000Z" });
    this.decisions.set("d-452", { id: "d-452", agentId: "a-fin", memoryIds: ["m-184"], summary: "Payment prepared", detail: seedDetails["d-452"], status: "suspect", createdAt: "2026-07-01T00:02:30.000Z" });
    this.actions.set("act-91", { id: "act-91", decisionId: "d-452", actionType: "wire_transfer", summary: "$24,000 settlement transfer", payload: { amount: 24000, currency: "USD", account: "ACCT-8842" }, status: "pending", createdAt: "2026-07-01T00:02:40.000Z" });
    this.verdicts.push({
      id: "ver-1",
      memoryId: "m-184",
      targetText: seedDetails["m-184"],
      verdict: "suspect",
      confidence: 0.94,
      reason: "Demo classifier: source conflicts with verified vendor records.",
      modelId: "demo-classifier",
      payload: {},
      createdAt: "2026-07-01T00:04:00.000Z",
    });
    this.contaminations.push({ id: "cont-1", memoryId: "m-184", verdictId: "ver-1", severity: "high", reason: "Source integrity check failed; conflicts with verified ERP record.", detectedBy: "security-verifier", createdAt: "2026-07-01T00:04:05.000Z" });
    this.attacks.set("attack-1", {
      id: "attack-1",
      pattern: seedDetails["m-184"],
      family: "settlement-redirection",
      embedding: demoVectorSync(seedDetails["m-184"], embeddingDimensions()),
      memoryId: "m-184",
      actor: "security-agent",
      affectedEntities: ["Zenith Systems", "ACCT-8842"],
      attackMethod: "document-poisoning",
      verdict: "suspect",
      verdictConfidence: 0.94,
      verdictReason: "Source conflicts with verified ERP records.",
      sourceCharacteristics: { docType: "policy", uri: "s3://antidote-evidence/vendor-policy.pdf" },
      provenance: { memoryId: "m-184", sourceUri: "s3://antidote-evidence/vendor-policy.pdf", actor: "security-agent" },
      createdAt: "2026-07-01T00:04:30.000Z",
    });
  }

  private edgeExists(from: string, to: string, relation: EdgeRelation): boolean {
    return this.edges.some((e) => e.from === from && e.to === to && e.relation === relation);
  }

  private addEdge(from: string, to: string, relation: EdgeRelation): void {
    if (!this.edgeExists(from, to, relation)) this.edges.push({ id: `e-${this.edgeCounter++}`, from, to, relation });
  }

  private memoryOf(node: MemoryRecord): MemoryRecord {
    return { ...node, embedding: undefined };
  }

  async findIngestionByKey(idempotencyKey: string): Promise<IngestionResult | null> {
    const job = [...this.jobs.values()].find((j) => j.idempotencyKey === idempotencyKey);
    return job?.result ?? null;
  }

  async createIngestion(input: { id: string; idempotencyKey?: string; sourceUri: string; contentHash: string; actor?: string }): Promise<IngestionJobRecord> {
    const job: IngestionJobRecord = { id: input.id, sourceUri: input.sourceUri, status: "running", idempotencyKey: input.idempotencyKey, contentHash: input.contentHash, createdAt: new Date().toISOString() };
    this.jobs.set(input.id, job);
    return job;
  }

  async ingestDocument(input: IngestDocumentInput & { jobId: string; contentHash: string; memories: PreparedMemory[]; contentType?: string; actor?: string }): Promise<IngestionResult> {
    const sourceNode: MemoryRecord = {
      id: shortId("src"),
      kind: "source",
      label: input.sourceUri.split("/").pop() ?? input.sourceUri,
      detail: input.sourceUri,
      content: input.content,
      contentHash: input.contentHash,
      sourceUri: input.sourceUri,
      status: "trusted",
      trust: 1,
      metadata: { contentType: input.contentType ?? null },
      createdAt: new Date().toISOString(),
    };
    this.nodes.set(sourceNode.id, sourceNode);
    const created: MemoryRecord[] = [];
    const duplicates: MemoryRecord[] = [];
    for (const candidate of input.memories) {
      const existing = [...this.nodes.values()].find((n) => n.contentHash === candidate.contentHash && isMemoryKind(n.kind));
      if (existing) {
        duplicates.push(existing);
        continue;
      }
      const node: MemoryRecord = {
        id: shortId("m"),
        kind: "memory",
        label: candidate.label,
        detail: candidate.detail,
        content: candidate.content,
        contentHash: candidate.contentHash,
        sourceUri: input.sourceUri,
        status: candidate.status ?? "trusted",
        trust: 1,
        embedding: candidate.embedding,
        metadata: {
          contentType: input.contentType ?? null,
          extractor: "pipeline",
          ...(candidate.screening ? { screening: candidate.screening } : {}),
        },
        createdAt: new Date().toISOString(),
      };
      this.nodes.set(node.id, node);
      this.addEdge(sourceNode.id, node.id, "created");
      created.push(node);
    }
    const stats = { candidates: input.memories.length, created: created.length, duplicates: duplicates.length, failed: 0 };
    const sanitize = (list: MemoryRecord[]): MemoryRecord[] => list.map((n) => this.memoryOf(n));
    const result: IngestionResult = { jobId: input.jobId, sourceUri: input.sourceUri, status: "completed", memories: sanitize([...created, ...duplicates]), created: sanitize(created), duplicates: sanitize(duplicates), stats };
    const job = this.jobs.get(input.jobId);
    if (job) {
      job.status = "completed";
      job.result = result;
    }
    return result;
  }

  async failIngestion(id: string, error: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.status = "failed";
      job.error = error;
    }
  }

  async getIngestion(id: string): Promise<IngestionJobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async listIngestions(limit = 100): Promise<IngestionJobRecord[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    const node = this.nodes.get(id);
    return node ? this.memoryOf(node) : null;
  }

  async listMemories(kind?: NodeKind, status?: NodeStatus): Promise<MemoryRecord[]> {
    return [...this.nodes.values()].filter((n) => (!kind || n.kind === kind) && (!status || n.status === status)).map((n) => this.memoryOf(n));
  }

  async searchMemories(input: SearchMemoriesInput): Promise<RetrievedMemory[]> {
    const query = input.query.trim();
    const k = input.k ?? 5;
    const candidates = [...this.nodes.values()].filter((n) => isMemoryKind(n.kind) && !isRevokedStatus(n.status));
    const queryVec = input.queryEmbedding;
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const scored = candidates.map((c) => {
      const haystack = `${c.label} ${c.detail} ${c.content ?? ""}`.toLowerCase();
      let keyword = 0;
      for (const term of terms) {
        if (haystack.includes(term)) keyword += 0.7;
      }
      let vector = 0;
      if (queryVec && c.embedding) vector = cosineSimilarity(queryVec, c.embedding);
      return { node: c, similarity: Math.max(keyword, vector) };
    });
    const ranked = scored.filter((s) => (input.minSimilarity === undefined || s.similarity >= input.minSimilarity) && s.similarity > 0).sort((a, b) => b.similarity - a.similarity).slice(0, k);
    const session = await this.getOrCreateSession(input.agentId);
    const events: RetrievedMemory[] = [];
    for (const { node, similarity } of ranked) {
      const event: RetrievalEvent = { id: shortId("rev"), agentId: input.agentId, memoryId: node.id, similarity, queryText: query, sessionId: session.id, context: input.context ?? {}, createdAt: new Date().toISOString() };
      this.retrievals.push(event);
      events.push({ memory: this.memoryOf(node), similarity, eventId: event.id });
    }
    await this.audit("retrieval.executed", input.agentId, undefined, { query, matches: events.length });
    return events;
  }

  async listRetrievalEvents(limit: number, agentId?: string): Promise<RetrievalEvent[]> {
    return this.retrievals.filter((e) => !agentId || e.agentId === agentId).slice(-limit).reverse();
  }

  async recordDecision(input: RecordDecisionInput): Promise<DecisionRecord> {
    if (input.idempotencyKey) {
      const existing = [...this.nodes.values()].find((n) => n.idempotencyKey === input.idempotencyKey);
      if (existing) {
        const prior = this.decisions.get(existing.id);
        if (prior) return prior;
      }
    }
    const memoryIds = [...new Set(input.memoryIds)];
    const missing = memoryIds.filter((id) => {
      const node = this.nodes.get(id);
      return !node || !isMemoryKind(node.kind);
    });
    if (missing.length) throw badRequest("Decision references unknown memory ids", { memoryIds: missing });
    const decisionId = shortId("d");
    const now = new Date().toISOString();
    if (!this.nodes.has(input.agentId)) {
      this.nodes.set(input.agentId, {
        id: input.agentId,
        kind: "agent",
        label: input.agentId,
        detail: input.agentId,
        content: input.agentId,
        contentHash: fnv1aHex(input.agentId),
        sourceUri: "urn:antidote:agent",
        status: "trusted",
        trust: 1,
        metadata: {},
        createdAt: now,
      });
    }
    const node: MemoryRecord = {
      id: decisionId,
      kind: "decision",
      label: input.summary,
      detail: input.detail ?? input.summary,
      content: input.summary,
      contentHash: fnv1aHex(`${input.agentId}:${input.summary}`),
      sourceUri: "urn:antidote:decision",
      status: "trusted",
      trust: 1,
      metadata: { context: input.context ?? {} },
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    };
    this.nodes.set(decisionId, node);
    this.addEdge(input.agentId, decisionId, "influenced");
    for (const memoryId of memoryIds) {
      this.addEdge(memoryId, input.agentId, "retrieved");
      for (const event of this.retrievals) {
        if (event.memoryId === memoryId && event.agentId === input.agentId && !event.decisionId) event.decisionId = decisionId;
      }
    }
    const decision: DecisionRecord = { id: decisionId, agentId: input.agentId, memoryIds, summary: input.summary, detail: input.detail ?? input.summary, status: "trusted", createdAt: now };
    this.decisions.set(decisionId, decision);
    await this.audit("decision.recorded", input.agentId, decisionId, { memoryIds });
    return decision;
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    return this.decisions.get(id) ?? null;
  }

  async recordAction(input: RecordActionInput): Promise<ActionRecord> {
    const decision = this.decisions.get(input.decisionId);
    if (!decision) throw badRequest(`Decision ${input.decisionId} does not exist`);
    if (input.idempotencyKey) {
      const prior = [...this.actions.values()].find((a) => a.idempotencyKey === input.idempotencyKey);
      if (prior) return prior;
    }
    const actionId = shortId("act");
    const now = new Date().toISOString();
    const action: ActionRecord = {
      id: actionId,
      decisionId: input.decisionId,
      actionType: input.actionType,
      summary: input.summary ?? `${input.actionType} action`,
      payload: input.payload ?? {},
      status: "pending",
      externalRef: input.externalRef,
      createdAt: now,
    };
    this.actions.set(actionId, action);
    const node: MemoryRecord = {
      id: actionId,
      kind: "action",
      label: action.summary,
      detail: action.summary,
      content: JSON.stringify(action.payload),
      contentHash: fnv1aHex(actionId),
      sourceUri: "urn:antidote:action",
      status: "trusted",
      trust: 1,
      metadata: { actionType: input.actionType },
      createdAt: now,
    };
    this.nodes.set(actionId, node);
    this.addEdge(input.decisionId, actionId, "produced");
    await this.audit("action.recorded", "agent", actionId, { decisionId: input.decisionId, actionType: input.actionType });
    return action;
  }

  async getAction(id: string): Promise<ActionRecord | null> {
    return this.actions.get(id) ?? null;
  }

  async recordDerivedMemory(input: RecordDerivedInput & { embedding: number[] }): Promise<MemoryRecord> {
    const decision = this.decisions.get(input.decisionId);
    if (!decision) throw badRequest(`Decision ${input.decisionId} does not exist`);
    if (input.idempotencyKey) {
      const existing = [...this.nodes.values()].find((n) => n.idempotencyKey === input.idempotencyKey);
      if (existing) return this.memoryOf(existing);
    }
    const derivedId = shortId("m");
    const now = new Date().toISOString();
    const node: MemoryRecord = {
      id: derivedId,
      kind: "derived",
      label: input.label,
      detail: input.detail,
      content: input.content ?? input.detail,
      contentHash: fnv1aHex(`${input.decisionId}:${input.detail}`),
      sourceUri: "urn:antidote:decision",
      status: "trusted",
      trust: 0.9,
      embedding: input.embedding,
      metadata: { parentDecisionId: input.decisionId },
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    };
    this.nodes.set(derivedId, node);
    this.addEdge(input.decisionId, derivedId, "produced");
    await this.audit("derived.recorded", "agent", derivedId, { parentDecisionId: input.decisionId });
    return this.memoryOf(node);
  }

  async getCausalChain(memoryId: string): Promise<CausalChain> {
    const root = this.nodes.get(memoryId);
    if (!root) throw badRequest(`Memory ${memoryId} does not exist`);
    const visited = new Set<string>([memoryId]);
    const queue = [memoryId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of this.edges) {
        if (edge.from === current && BLAST_RELATIONS.includes(edge.relation) && !visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    const createdBy = this.edges.find((e) => e.to === memoryId && e.relation === "created");
    if (createdBy) visited.add(createdBy.from);
    const nodes = [...visited].map((id) => this.nodes.get(id)).filter((n): n is MemoryRecord => Boolean(n));
    const source = nodes.find((n) => n.kind === "source") ?? null;
    const memory = this.nodes.get(memoryId)!;
    const retrievals = this.retrievals.filter((e) => visited.has(e.memoryId));
    const decisions = [...this.decisions.values()].filter((d) => visited.has(d.id));
    const actions = [...this.actions.values()].filter((a) => visited.has(a.id));
    const derived = nodes.filter((n) => n.kind === "derived");
    const sessions = [...this.sessions.values()].filter((s) => nodes.some((n) => n.id === s.agentId));
    const verdicts = this.verdicts.filter((v) => v.memoryId && visited.has(v.memoryId));
    const contaminations = this.contaminations.filter((c) => visited.has(c.memoryId));
    return { rootMemoryId: memoryId, source: source ? this.memoryOf(source) : null, memory: this.memoryOf(memory), retrievals, decisions, actions, derived: derived.map((n) => this.memoryOf(n)), nodes: nodes.map((n) => this.memoryOf(n)), sessions, verdicts, contaminations };
  }

  async getScenario(): Promise<Scenario> {
    const nodes = [...this.nodes.values()];
    const root = nodes.find((n) => n.id === "m-184") ?? nodes.find((n) => n.kind === "memory" || n.kind === "derived");
    const plan = root && isMemoryKind(root.kind) ? await this.computeBlastRadius(root.id) : { rootMemoryId: "", memoryIds: [], decisionIds: [], actionIds: [], needsReevaluation: [] };
    const repaired = root ? isRevokedStatus(root.status) : false;
    const usedBy = new Map<string, number>();
    for (const edge of this.edges) {
      if (edge.relation === "retrieved") usedBy.set(edge.from, (usedBy.get(edge.from) ?? 0) + 1);
    }
    const descendants = (id: string): number => {
      const closure = new Set<string>([id]);
      const queue = [id];
      while (queue.length) {
        const current = queue.shift()!;
        for (const edge of this.edges) {
          if (edge.from === current && BLAST_RELATIONS.includes(edge.relation) && !closure.has(edge.to)) {
            closure.add(edge.to);
            queue.push(edge.to);
          }
        }
      }
      return [...closure].filter((nid) => this.nodes.get(nid)?.kind !== "agent").length;
    };
    return {
      id: "zenith-poisoning",
      title: repaired ? "Containment complete" : "Active contamination detected",
      subtitle: repaired ? "Influence chain repaired; Zenith requires re-verification." : "A compromised source has influenced multiple autonomous decisions.",
      phase: repaired ? "repaired" : "infected",
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        detail: n.detail,
        status: n.status,
        trust: Math.round(n.trust * 100),
        x: seedLayout[n.id]?.x ?? 200 + (visitedRank(n.id, this.edges, root?.id) * 160),
        y: seedLayout[n.id]?.y ?? 60 + (nodes.indexOf(n) % 5) * 70,
        usedBy: usedBy.get(n.id) ?? 0,
        descendants: descendants(n.id),
      })),
      edges: this.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, relation: e.relation })),
      blastRadius: { memories: plan.memoryIds.length + 1, decisions: plan.decisionIds.length, actions: plan.actionIds.length, agents: plan.needsReevaluation.length },
    };
  }

  async computeBlastRadius(rootMemoryId: string): Promise<RepairPlan> {
    if (!this.nodes.has(rootMemoryId)) throw badRequest(`Memory ${rootMemoryId} does not exist`);
    const visited = new Map<string, number>();
    const queue: { id: string; depth: number }[] = [{ id: rootMemoryId, depth: 0 }];
    visited.set(rootMemoryId, 0);
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of this.edges) {
        if (edge.from === current.id && BLAST_RELATIONS_WITH_SOURCE.includes(edge.relation) && !visited.has(edge.to)) {
          visited.set(edge.to, current.depth + 1);
          queue.push({ id: edge.to, depth: current.depth + 1 });
        }
      }
    }
    const nodes: RepairPlanNode[] = [...visited.entries()]
      .map(([id, depth]) => {
        const node = this.nodes.get(id);
        return node ? { id: node.id, kind: node.kind, status: node.status, depth } : null;
      })
      .filter((n): n is RepairPlanNode => Boolean(n));
    const edges: RepairPlanEdge[] = this.edges
      .filter((e) => visited.has(e.from) && visited.has(e.to))
      .map((e) => ({ from: e.from, to: e.to, relation: e.relation }));
    const kinds = new Map(nodes.map((n) => [n.id, n.kind]));
    const statuses = new Map(nodes.map((n) => [n.id, n.status]));
    const actionStatuses = new Map([...this.actions.values()].map((a) => [a.id, a.status]));
    const memoryIds = [...kinds].filter(([, kind]) => isMemoryKind(kind)).map(([id]) => id).filter((id) => id !== rootMemoryId);
    const decisions = [...kinds].filter(([, kind]) => kind === "decision").map(([id]) => id);
    const actionIds = [...kinds].filter(([, kind]) => kind === "action").map(([id]) => id);
    const cancelActionIds = actionIds.filter((id) => (actionStatuses.get(id) ?? statuses.get(id)) === "pending");
    const reviewActionIds = actionIds.filter((id) => ["completed", "executing"].includes(actionStatuses.get(id) ?? statuses.get(id) ?? ""));
    const retrievalEventIds = this.retrievals.filter((e) => visited.has(e.memoryId)).map((e) => e.id);
    const evidence: PlanEvidence[] = this.revocations.filter((r) => visited.has(r.memoryId)).map((r) => ({ id: r.id, memoryId: r.memoryId, uri: r.evidenceUri }));
    const reevaluations: PlanReevaluation[] = [...this.decisions.values()]
      .filter((d) => visited.has(d.id))
      .map((d) => ({ agentId: d.agentId, decisionId: d.id, reason: `decision invalidated by repair of ${rootMemoryId}` }));
    return {
      rootMemoryId,
      memoryIds,
      derivedMemoryIds: memoryIds.filter((id) => kinds.get(id) === "derived"),
      decisionIds: decisions,
      actionIds,
      cancelActionIds,
      reviewActionIds,
      needsReevaluation: [...kinds].filter(([, kind]) => kind === "agent").map(([id]) => id),
      retrievalEventIds,
      evidence,
      reevaluations,
      graph: { nodes, edges },
    };
  }

  async executeRepair(input: ExecuteRepairInput): Promise<RepairResult> {
    // Serialize concurrent repairs through a promise chain so the plan-hash
    // idempotency check and the state transitions run atomically in JS.
    const run = this.repairChain.then(() => this.performRepair(input));
    this.repairChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async performRepair(input: ExecuteRepairInput): Promise<RepairResult> {
    const { plan, reason, actor, evidenceUri } = input;
    if (!this.nodes.has(plan.rootMemoryId)) throw badRequest(`Memory ${plan.rootMemoryId} does not exist`);
    const planHash = planHashOf(plan);
    const prior = this.repairs.find((r) => r.rootMemoryId === plan.rootMemoryId && r.planHash === planHash && r.status === "completed");
    if (prior) {
      return { repairId: prior.id, status: "completed", executed: false, ...plan, reEvaluationIds: prior.reEvaluationIds ?? [], revocationId: prior.revocationId, repairedAt: prior.createdAt };
    }
    // A root that is already repaired means its influence was fully revoked by
    // an earlier repair; a follow-up call (even with a shifted plan) is a replay.
    const rootNode = this.nodes.get(plan.rootMemoryId);
    const priorAny = this.repairs.find((r) => r.rootMemoryId === plan.rootMemoryId && r.status === "completed");
    if (rootNode?.status === "repaired" && priorAny) {
      return { repairId: priorAny.id, status: "completed", executed: false, ...plan, reEvaluationIds: priorAny.reEvaluationIds ?? [], revocationId: priorAny.revocationId, repairedAt: priorAny.createdAt };
    }
    const now = new Date().toISOString();
    const repairedAt = now;
    for (const memoryId of plan.memoryIds) {
      const node = this.nodes.get(memoryId);
      if (node) node.status = "quarantined";
    }
    for (const decisionId of plan.decisionIds) {
      const node = this.nodes.get(decisionId);
      if (node) node.status = "invalidated";
      const decision = this.decisions.get(decisionId);
      if (decision) decision.status = "invalidated";
    }
    for (const actionId of plan.cancelActionIds) {
      const node = this.nodes.get(actionId);
      if (node) node.status = "cancelled";
      const action = this.actions.get(actionId);
      if (action) action.status = "cancelled";
    }
    for (const actionId of plan.reviewActionIds) {
      const node = this.nodes.get(actionId);
      if (node) node.status = "requires_review";
      const action = this.actions.get(actionId);
      if (action) action.status = "requires_review";
    }
    const root = this.nodes.get(plan.rootMemoryId);
    if (root) root.status = "repaired";
    const repairId = shortId("repair");
    const revocation = await this.recordRevocation({ memoryId: plan.rootMemoryId, reason: reason ?? "memory integrity failure", actor: actor ?? "security-agent", evidenceUri });
    await this.recordContamination({ memoryId: plan.rootMemoryId, severity: "critical", reason: reason ?? "confirmed memory poisoning", detectedBy: actor ?? "security-agent" });
    const reEvaluationIds = plan.reevaluations.map((r) => {
      const reEval: ReEvaluation = { id: shortId("reeval"), memoryId: plan.rootMemoryId, agentId: r.agentId, decisionId: r.decisionId, reason: r.reason, status: "pending", createdAt: now };
      this.reEvaluations.push(reEval);
      return reEval.id;
    });
    this.repairs.push({ id: repairId, rootMemoryId: plan.rootMemoryId, status: "completed", planHash, revocationId: revocation.id, reEvaluationIds, createdAt: now });
    await this.audit("repair.completed", actor ?? "security-agent", repairId, { rootMemoryId: plan.rootMemoryId, plan, planHash, reEvaluationIds });
    return { repairId, status: "completed", executed: true, ...plan, reEvaluationIds, revocationId: revocation.id, repairedAt };
  }

  async recordRevocation(input: RevocationInput): Promise<RevocationRecord> {
    const record: RevocationRecord = { id: shortId("rev"), memoryId: input.memoryId, reason: input.reason, actor: input.actor, evidenceUri: input.evidenceUri, createdAt: new Date().toISOString() };
    this.revocations.push(record);
    await this.audit("revocation.recorded", input.actor, input.memoryId, { reason: input.reason, evidenceUri: input.evidenceUri });
    return record;
  }

  async getOrCreateSession(agentId: string, metadata?: Record<string, unknown>): Promise<AgentSession> {
    const existing = [...this.sessions.values()].find((s) => s.agentId === agentId && s.status === "active");
    if (existing) return existing;
    const session: AgentSession = { id: shortId("sess"), agentId, status: "active", metadata: metadata ?? {}, startedAt: new Date().toISOString() };
    this.sessions.set(session.id, session);
    return session;
  }

  async startFreshSession(agentId: string, metadata?: Record<string, unknown>): Promise<AgentSession> {
    const endedAt = new Date().toISOString();
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId && session.status === "active") {
        session.status = "closed";
        session.endedAt = endedAt;
      }
    }
    const session: AgentSession = { id: shortId("sess"), agentId, status: "active", metadata: metadata ?? {}, startedAt: endedAt };
    this.sessions.set(session.id, session);
    await this.audit("agent.session.refreshed", agentId, session.id, metadata ?? {});
    return session;
  }

  async listSessions(limit = 100): Promise<AgentSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async recordSecurityVerdict(input: RecordVerdictInput): Promise<SecurityVerdict> {
    const verdict: SecurityVerdict = {
      id: shortId("ver"),
      memoryId: input.memoryId,
      targetText: input.targetText,
      verdict: input.verdict,
      confidence: input.confidence,
      reason: input.reason,
      modelId: input.modelId,
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    };
    this.verdicts.push(verdict);
    await this.audit("verdict.recorded", "security-verifier", input.memoryId ?? verdict.id, { verdict: verdict.verdict, confidence: verdict.confidence });
    return verdict;
  }

  async listSecurityVerdicts(limit = 100): Promise<SecurityVerdict[]> {
    return [...this.verdicts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async recordContamination(input: RecordContaminationInput): Promise<ContaminationEvent> {
    if (!this.nodes.has(input.memoryId)) throw badRequest(`Memory ${input.memoryId} does not exist`);
    const event: ContaminationEvent = {
      id: shortId("cont"),
      memoryId: input.memoryId,
      verdictId: input.verdictId,
      severity: input.severity ?? "high",
      reason: input.reason,
      detectedBy: input.detectedBy,
      createdAt: new Date().toISOString(),
    };
    this.contaminations.push(event);
    await this.audit("contamination.recorded", input.detectedBy, input.memoryId, { severity: event.severity, reason: event.reason });
    return event;
  }

  async listContaminationEvents(limit = 100): Promise<ContaminationEvent[]> {
    return [...this.contaminations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async recordAttackMemory(input: RecordAttackInput): Promise<AttackMemory> {
    const attack: AttackMemory = {
      id: shortId("attack"),
      pattern: input.pattern,
      family: input.family ?? "unknown",
      embedding: input.embedding,
      memoryId: input.memoryId,
      revocationId: input.revocationId,
      actor: input.actor,
      affectedEntities: input.affectedEntities,
      sourceCharacteristics: input.sourceCharacteristics,
      attackMethod: input.attackMethod,
      verdict: input.verdict,
      verdictConfidence: input.verdictConfidence,
      verdictReason: input.verdictReason,
      repairId: input.repairId,
      provenance: input.provenance,
      createdAt: new Date().toISOString(),
    };
    this.attacks.set(attack.id, attack);
    await this.audit("attack.recorded", input.actor, attack.id, { family: attack.family, memoryId: input.memoryId });
    return attack;
  }

  async listAttackMemories(limit = 100): Promise<AttackMemory[]> {
    return [...this.attacks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async matchPoisonPatterns(queryEmbedding: number[], k = 3, minSimilarity = 0.6): Promise<AttackMemoryMatch[]> {
    return [...this.attacks.values()]
      .filter((a) => a.embedding)
      .map((attack) => ({ attack, similarity: cosineSimilarity(queryEmbedding, attack.embedding!) }))
      .filter((m) => m.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  async getDependencies(input: DependencyQuery): Promise<Dependency[]> {
    const root = this.nodes.get(input.memoryId);
    if (!root) throw badRequest(`Memory ${input.memoryId} does not exist`);
    const relations = new Set(input.relations ?? BLAST_RELATIONS);
    const maxDepth = input.maxDepth ?? 10;
    const results: Dependency[] = [];
    const seen = new Set<string>();
    const queue: { id: string; depth: number; relation: EdgeRelation; relationFrom: string }[] = [{ id: input.memoryId, depth: 0, relation: "dependency", relationFrom: "" }];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      if (current.depth > 0) {
        const node = this.nodes.get(current.id);
        if (node) results.push({ id: node.id, kind: node.kind, label: node.label, depth: current.depth, relation: current.relation, relationFrom: current.relationFrom });
      }
      if (current.depth >= maxDepth) continue;
      if (input.direction === "down") {
        for (const edge of this.edges) {
          if (edge.from === current.id && relations.has(edge.relation)) queue.push({ id: edge.to, depth: current.depth + 1, relation: edge.relation, relationFrom: current.id });
        }
      } else {
        for (const edge of this.edges) {
          if (edge.to === current.id && relations.has(edge.relation)) queue.push({ id: edge.from, depth: current.depth + 1, relation: edge.relation, relationFrom: current.id });
        }
      }
    }
    return results;
  }

  async listReEvaluations(limit = 100): Promise<ReEvaluation[]> {
    return [...this.reEvaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async startReEvaluation(id: string): Promise<ReEvaluation | null> {
    const record = this.reEvaluations.find((r) => r.id === id);
    if (!record || record.status === "completed" || record.status === "running") return null;
    record.status = "running";
    record.startedAt = new Date().toISOString();
    record.attemptCount = (record.attemptCount ?? 0) + 1;
    record.error = undefined;
    await this.audit("reevaluation.started", "repair-worker", record.id, { agentId: record.agentId, decisionId: record.decisionId, attemptCount: record.attemptCount });
    return { ...record };
  }

  async completeReEvaluation(id: string, result: Record<string, unknown> = {}, replacementDecisionId?: string): Promise<ReEvaluation | null> {
    const record = this.reEvaluations.find((r) => r.id === id);
    if (!record) return null;
    record.status = "completed";
    record.result = result;
    record.replacementDecisionId = replacementDecisionId;
    record.error = undefined;
    record.completedAt = new Date().toISOString();
    await this.audit("reevaluation.completed", "repair-worker", record.id, { agentId: record.agentId, decisionId: record.decisionId, replacementDecisionId, result });
    return { ...record };
  }

  async failReEvaluation(id: string, error: string): Promise<ReEvaluation | null> {
    const record = this.reEvaluations.find((r) => r.id === id);
    if (!record) return null;
    record.status = "failed";
    record.error = error;
    record.failedAt = new Date().toISOString();
    await this.audit("reevaluation.failed", "repair-worker", record.id, { agentId: record.agentId, decisionId: record.decisionId, error });
    return { ...record };
  }

  async listRepairJobs(limit = 100): Promise<RepairJob[]> {
    return [...this.repairs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((r) => ({
      id: r.id,
      rootMemoryId: r.rootMemoryId,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.createdAt,
    }));
  }

  async recordMcpOperation(input: { agentId: string; capability: McpCapability; params: Record<string, unknown>; status: "completed" | "failed"; durationMs: number; result?: unknown; error?: string }): Promise<McpOperation> {
    const operation: McpOperation = {
      id: shortId("mcp"),
      agentId: input.agentId,
      capability: input.capability,
      params: input.params,
      status: input.status,
      durationMs: input.durationMs,
      result: input.result,
      error: input.error,
      createdAt: new Date().toISOString(),
    };
    this.mcpOperations.push(operation);
    return operation;
  }

  async listMcpOperations(limit = 100, agentId?: string): Promise<McpOperation[]> {
    return [...this.mcpOperations].filter((op) => !agentId || op.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async audit(eventType: string, actor: string, objectId: string | undefined, payload: Record<string, unknown>): Promise<void> {
    this.audits.push({ id: shortId("aud"), eventType, actor, objectId, payload, createdAt: new Date().toISOString() });
  }

  async listAuditEvents(limit = 200): Promise<AuditEvent[]> {
    return [...this.audits].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((a) => ({
      id: a.id,
      eventType: a.eventType,
      actor: a.actor,
      objectId: a.objectId,
      payload: a.payload,
      createdAt: a.createdAt,
    }));
  }
}

function visitedRank(id: string, edges: MemoryEdge[], rootId?: string): number {
  if (!rootId || id === rootId) return 0;
  let rank = 0;
  let current = id;
  const seen = new Set<string>();
  while (current !== rootId && !seen.has(current)) {
    seen.add(current);
    const edge = edges.find((e) => e.to === current);
    if (!edge) return rank + 1;
    current = edge.from;
    rank++;
    if (seen.has(current)) return rank;
  }
  return rank;
}

type StoreRuntimeState = {
  resolved?: MemoryStore;
  seedStore: boolean;
};

const globalStoreRuntime = globalThis as typeof globalThis & {
  __antidoteStoreRuntime?: StoreRuntimeState;
};

function storeRuntime(): StoreRuntimeState {
  globalStoreRuntime.__antidoteStoreRuntime ??= { seedStore: true };
  return globalStoreRuntime.__antidoteStoreRuntime;
}

function loadPostgresStore(): MemoryStore {
  // Imported lazily to avoid pulling pg into demo/browser bundles.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./store-postgres") as typeof import("./store-postgres");
  return new mod.PostgresStore();
}

export function getStore(): MemoryStore {
  const runtime = storeRuntime();
  if (!runtime.resolved) {
    runtime.resolved = isDemo() || !hasDatabase() ? new InMemoryStore(runtime.seedStore) : loadPostgresStore();
  }
  return runtime.resolved;
}

export function resetStore(seed = true): void {
  const runtime = storeRuntime();
  runtime.seedStore = seed;
  runtime.resolved = undefined;
}

export function useEmptyDemoStore(): void {
  resetStore(false);
}

export function assertStoreHealthy(): void {
  if (!isDemo() && !hasDatabase()) {
    throw conflict("DATABASE_URL is required in live mode", { demo: isDemo(), database: hasDatabase() });
  }
}
