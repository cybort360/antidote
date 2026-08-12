export type NodeKind = "source" | "memory" | "agent" | "decision" | "action" | "derived";
// ACTIVE = trusted (the normal live state). Repair terminals: REVOKED
// (root memory), QUARANTINED (dependent memories), INVALIDATED (decisions),
// CANCELLED (pending actions), REQUIRES_REVIEW (irreversible actions).
// REPAIRED marks nodes whose influence was repaired by a completed repair job.
export type NodeStatus = "trusted" | "active" | "suspect" | "revoked" | "quarantined" | "invalidated" | "cancelled" | "repaired" | "requires_review";
export type EdgeRelation = "created" | "retrieved" | "influenced" | "produced" | "derived" | "dependency";
export type ActionStatus = "pending" | "executing" | "completed" | "cancelled" | "failed" | "requires_review";
export type IngestionStatus = "running" | "completed" | "failed";

export type MemoryNode = {
  id: string;
  kind: NodeKind;
  label: string;
  detail: string;
  status: NodeStatus;
  trust: number;
  x: number;
  y: number;
  usedBy?: number;
  descendants?: number;
};

export type MemoryEdge = {
  id: string;
  from: string;
  to: string;
  relation: "created" | "retrieved" | "influenced" | "produced" | "derived" | "dependency";
};

export type MemoryRecord = {
  id: string;
  kind: NodeKind;
  label: string;
  detail: string;
  status: NodeStatus;
  trust: number;
  content?: string;
  contentHash: string;
  sourceUri: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  idempotencyKey?: string;
  repairedAt?: string;
  createdAt: string;
};

export type RetrievalEvent = {
  id: string;
  agentId: string;
  memoryId: string;
  similarity: number;
  queryText: string;
  decisionId?: string;
  sessionId?: string;
  context: Record<string, unknown>;
  createdAt: string;
};

export type DecisionRecord = {
  id: string;
  agentId: string;
  memoryIds: string[];
  summary: string;
  detail: string;
  status: NodeStatus;
  createdAt: string;
};

export type ActionRecord = {
  id: string;
  decisionId: string;
  actionType: string;
  summary: string;
  payload: Record<string, unknown>;
  status: ActionStatus;
  externalRef?: string;
  idempotencyKey?: string;
  createdAt: string;
};

export type CausalChain = {
  rootMemoryId: string;
  source: MemoryRecord | null;
  memory: MemoryRecord;
  retrievals: RetrievalEvent[];
  decisions: DecisionRecord[];
  actions: ActionRecord[];
  derived: MemoryRecord[];
  nodes: MemoryRecord[];
  sessions: AgentSession[];
  verdicts: SecurityVerdict[];
  contaminations: ContaminationEvent[];
};

export type IngestDocumentInput = {
  sourceUri: string;
  content: string;
  contentType?: string;
  actor?: string;
  idempotencyKey?: string;
};

export type ExtractedCandidate = {
  label: string;
  detail: string;
  content: string;
};

export type IngestionResult = {
  jobId: string;
  sourceUri: string;
  status: IngestionStatus;
  memories: MemoryRecord[];
  created: MemoryRecord[];
  duplicates: MemoryRecord[];
  stats: { candidates: number; created: number; duplicates: number; failed: number };
};

export type SearchMemoriesInput = {
  agentId: string;
  query: string;
  k?: number;
  minSimilarity?: number;
  context?: Record<string, unknown>;
  queryEmbedding?: number[];
};

export type RetrievedMemory = {
  memory: MemoryRecord;
  similarity: number;
  eventId: string;
};

export type RecordDecisionInput = {
  agentId: string;
  memoryIds: string[];
  summary: string;
  detail?: string;
  idempotencyKey?: string;
  context?: Record<string, unknown>;
};

export type RecordActionInput = {
  decisionId: string;
  actionType: string;
  payload?: Record<string, unknown>;
  summary?: string;
  externalRef?: string;
  idempotencyKey?: string;
};

export type RecordDerivedInput = {
  decisionId: string;
  label: string;
  detail: string;
  content?: string;
  idempotencyKey?: string;
};

export type RevocationInput = {
  memoryId: string;
  reason: string;
  actor: string;
  evidenceUri?: string;
};

export type RevocationRecord = {
  id: string;
  memoryId: string;
  reason: string;
  actor: string;
  evidenceUri?: string;
  createdAt: string;
};

export type SessionStatus = "active" | "closed" | "expired";

export type AgentSession = {
  id: string;
  agentId: string;
  status: SessionStatus;
  metadata: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
};

export type SecurityVerdictKind = "trusted" | "suspect" | "review";

export type SecurityVerdict = {
  id: string;
  memoryId?: string;
  targetText: string;
  verdict: SecurityVerdictKind;
  confidence: number;
  reason?: string;
  modelId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ContaminationEvent = {
  id: string;
  memoryId: string;
  verdictId?: string;
  severity: "low" | "medium" | "high" | "critical";
  reason?: string;
  detectedBy: string;
  createdAt: string;
};

export type AttackMemory = {
  id: string;
  pattern: string;
  family: string;
  embedding?: number[];
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
  createdAt: string;
};

export type AttackMemoryMatch = {
  attack: AttackMemory;
  similarity: number;
};

export type ScreeningFactor = "semantic" | "entity" | "source" | "method";

export type ScreeningEvidence = {
  attackId: string;
  family: string;
  factor: ScreeningFactor;
  similarity?: number;
  detail: string;
};

export type ScreeningMeta = {
  riskScore: number;
  threshold: number;
  blocked: boolean;
  evidence: ScreeningEvidence[];
};

export type ScreenedCandidate = {
  memoryId?: string;
  label: string;
  detail: string;
  riskScore: number;
  threshold: number;
  blocked: boolean;
  evidence: ScreeningEvidence[];
};

export type ScreeningResult = {
  candidates: ScreenedCandidate[];
  blocked: ScreenedCandidate[];
  trusted: ScreenedCandidate[];
};

export type DependencyDirection = "down" | "up";

export type Dependency = {
  id: string;
  kind: NodeKind;
  label: string;
  depth: number;
  relation: EdgeRelation;
  relationFrom: string;
};

export type DependencyQuery = {
  memoryId: string;
  direction: DependencyDirection;
  maxDepth?: number;
  relations?: EdgeRelation[];
};

export type ReEvaluation = {
  id: string;
  memoryId: string;
  agentId: string;
  decisionId?: string;
  reason?: string;
  status: "pending" | "running" | "completed" | "failed";
  attemptCount?: number;
  result?: Record<string, unknown>;
  error?: string;
  replacementDecisionId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
};

export type McpCapability = "list_tables" | "get_schema" | "get_memory_lineage" | "get_blast_radius" | "get_repair_status";

export type McpOperation = {
  id: string;
  agentId: string;
  capability: McpCapability;
  params: Record<string, unknown>;
  status: "completed" | "failed";
  durationMs: number;
  result?: unknown;
  error?: string;
  createdAt: string;
};

export type RepairJob = {
  id: string;
  rootMemoryId: string;
  status: string;
  actor?: string;
  reason?: string;
  createdAt: string;
  completedAt?: string;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  actor: string;
  objectId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Scenario = {
  id: string;
  title: string;
  subtitle: string;
  phase: "infected" | "simulated" | "repaired";
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  blastRadius: {
    memories: number;
    decisions: number;
    actions: number;
    agents: number;
  };
};
