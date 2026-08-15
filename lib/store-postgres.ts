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
  SearchMemoriesInput,
  SecurityVerdict,
} from "./types";
import { db, withTransaction } from "./db";
import { badRequest, isPgUniqueViolation } from "./errors";
import { fnv1aHex, shortId } from "./hash";
import type { ExecuteRepairInput, IngestionJobRecord, MemoryStore, PlanEvidence, PlanReevaluation, PreparedMemory, RecordAttackInput, RecordContaminationInput, RecordVerdictInput, RepairPlan, RepairPlanNode, RepairResult } from "./store";
import type { ScreeningMeta } from "./types";
import { BLAST_RELATIONS, isMemoryKind, isRevokedStatus, planHashOf } from "./store";

const NODE_FIELDS = "id, kind, label, detail, status, trust, content, content_hash, source_uri, metadata, idempotency_key, repaired_at, created_at";

function rowToMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    kind: row.kind as NodeKind,
    label: String(row.label),
    detail: String(row.detail),
    status: row.status as NodeStatus,
    trust: Number(row.trust),
    content: row.content != null ? String(row.content) : undefined,
    contentHash: row.content_hash != null ? String(row.content_hash) : fnv1aHex(String(row.id)),
    sourceUri: String(row.source_uri ?? "urn:antidote:unknown"),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key != null ? String(row.idempotency_key) : undefined,
    repairedAt: row.repaired_at != null ? new Date(row.repaired_at as string).toISOString() : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class PostgresStore implements MemoryStore {
  async findIngestionByKey(idempotencyKey: string): Promise<IngestionResult | null> {
    const { rows } = await db().query(`SELECT result FROM ingestion_jobs WHERE idempotency_key = $1 AND status = 'completed'`, [idempotencyKey]);
    if (!rows.length) return null;
    return rows[0].result as IngestionResult;
  }

  async findIngestionByContent(sourceUri: string, contentHash: string): Promise<IngestionResult | null> {
    const { rows } = await db().query(
      `SELECT result FROM ingestion_jobs WHERE source_uri = $1 AND content_hash = $2 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
      [sourceUri, contentHash],
    );
    return rows.length ? rows[0].result as IngestionResult : null;
  }

  async createIngestion(input: { id: string; idempotencyKey?: string; sourceUri: string; contentHash: string; actor?: string }): Promise<IngestionJobRecord> {
    await db().query(`INSERT INTO ingestion_jobs (id, idempotency_key, source_uri, content_hash, actor, status) VALUES ($1,$2,$3,$4,$5,'running')`, [input.id, input.idempotencyKey ?? null, input.sourceUri, input.contentHash, input.actor ?? null]);
    return { id: input.id, sourceUri: input.sourceUri, status: "running", idempotencyKey: input.idempotencyKey, contentHash: input.contentHash, createdAt: new Date().toISOString() };
  }

  async ingestDocument(input: IngestDocumentInput & { jobId: string; contentHash: string; memories: PreparedMemory[]; contentType?: string; actor?: string }): Promise<IngestionResult> {
    return withTransaction(async (query) => {
      const sourceId = shortId("src");
      const sourceInsert = await query(
        `INSERT INTO memory_nodes (id, kind, label, detail, content, content_hash, source_uri, status, trust, metadata)
         VALUES ($1, 'source', $2, $3, $4, $5, $6, 'trusted', 1.0, $7::JSONB)
         ON CONFLICT (kind, content_hash) WHERE kind IN ('source','memory') DO NOTHING
         RETURNING id`,
        [sourceId, input.sourceUri.split("/").pop() ?? input.sourceUri, input.sourceUri, input.content, input.contentHash, input.sourceUri, JSON.stringify({ contentType: input.contentType ?? null })],
      );
      const persistedSourceId = sourceInsert.rows.length ? String(sourceInsert.rows[0].id) : null;
      const created: MemoryRecord[] = [];
      const duplicates: MemoryRecord[] = [];
      for (const candidate of input.memories) {
        const memoryId = shortId("m");
        const screeningMeta: ScreeningMeta | null = candidate.screening ?? null;
        const inserted = await query(
          `INSERT INTO memory_nodes (id, kind, label, detail, content, content_hash, source_uri, status, trust, embedding, metadata)
           VALUES ($1, 'memory', $2, $3, $4, $5, $6, $7, 1.0, $8::VECTOR, $9::JSONB)
           ON CONFLICT (kind, content_hash) WHERE kind IN ('source','memory') DO NOTHING
           RETURNING ${NODE_FIELDS}`,
          [memoryId, candidate.label, candidate.detail, candidate.content, candidate.contentHash, input.sourceUri, candidate.status ?? "trusted", toVector(candidate.embedding), JSON.stringify({ contentType: input.contentType ?? null, extractor: "pipeline", ...(screeningMeta ? { screening: screeningMeta } : {}) })],
        );
        if (inserted.rows.length) {
          created.push(rowToMemory(inserted.rows[0]));
          if (persistedSourceId) {
            await query(`INSERT INTO memory_edges (from_id, to_id, relation) VALUES ($1, $2, 'created') ON CONFLICT DO NOTHING`, [persistedSourceId, String(inserted.rows[0].id)]);
          }
        } else {
          const { rows } = await query(`SELECT ${NODE_FIELDS} FROM memory_nodes WHERE content_hash = $1 AND kind = 'memory' LIMIT 1`, [candidate.contentHash]);
          duplicates.push(rowToMemory(rows[0]));
        }
      }
      const stats = { candidates: input.memories.length, created: created.length, duplicates: duplicates.length, failed: 0 };
      const result: IngestionResult = { jobId: input.jobId, sourceUri: input.sourceUri, status: "completed", memories: [...created, ...duplicates], created, duplicates, stats };
      await query(
        `UPDATE ingestion_jobs SET status = 'completed', stats = $2::JSONB, result = $3::JSONB, completed_at = now() WHERE id = $1`,
        [input.jobId, JSON.stringify(stats), JSON.stringify({ ...result, memories: result.memories, created: result.created, duplicates: result.duplicates })],
      );
      await query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ('ingestion.completed', $1, $2, $3::JSONB)`, [input.actor ?? "pipeline", input.jobId, JSON.stringify({ sourceUri: input.sourceUri, stats })]);
      return result;
    });
  }

  async failIngestion(id: string, error: string): Promise<void> {
    await db().query(`UPDATE ingestion_jobs SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`, [id, error]);
  }

  async getIngestion(id: string): Promise<IngestionJobRecord | null> {
    const { rows } = await db().query(`SELECT id, source_uri, status, idempotency_key, content_hash, error, created_at FROM ingestion_jobs WHERE id = $1`, [id]);
    if (!rows.length) return null;
    const row = rows[0];
    return { id: String(row.id), sourceUri: String(row.source_uri), status: row.status, idempotencyKey: row.idempotency_key ?? undefined, contentHash: String(row.content_hash), error: row.error ?? undefined, createdAt: new Date(row.created_at as string).toISOString() };
  }

  async listIngestions(limit = 100): Promise<IngestionJobRecord[]> {
    const { rows } = await db().query(`SELECT id, source_uri, status, idempotency_key, content_hash, error, created_at FROM ingestion_jobs ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map((row) => ({
      id: String(row.id),
      sourceUri: String(row.source_uri),
      status: row.status,
      idempotencyKey: row.idempotency_key ?? undefined,
      contentHash: String(row.content_hash),
      error: row.error ?? undefined,
      createdAt: new Date(row.created_at as string).toISOString(),
    }));
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    const { rows } = await db().query(`SELECT ${NODE_FIELDS} FROM memory_nodes WHERE id = $1`, [id]);
    return rows.length ? rowToMemory(rows[0]) : null;
  }

  async listMemories(kind?: NodeKind, status?: NodeStatus): Promise<MemoryRecord[]> {
    const { rows } = await db().query(`SELECT ${NODE_FIELDS} FROM memory_nodes WHERE ($1::STRING IS NULL OR kind = $1) AND ($2::STRING IS NULL OR status = $2) ORDER BY created_at DESC`, [kind ?? null, status ?? null]);
    return rows.map(rowToMemory);
  }

  async searchMemories(input: SearchMemoriesInput): Promise<RetrievedMemory[]> {
    const k = input.k ?? 5;
    let scored: { id: string; similarity: number }[] = [];
    const queryVec = input.queryEmbedding;
    if (queryVec && queryVec.length) {
      const { rows } = await db().query(
        `SELECT id, 1 - (embedding <=> $2::VECTOR) AS similarity
         FROM memory_nodes
         WHERE kind IN ('memory','derived') AND embedding IS NOT NULL AND status NOT IN ('revoked','quarantined','invalidated','cancelled')
           AND ($3::FLOAT8 IS NULL OR 1 - (embedding <=> $2::VECTOR) >= $3)
         ORDER BY embedding <=> $2::VECTOR
         LIMIT $1`,
        [k, toVector(queryVec), input.minSimilarity ?? null],
      );
      scored = rows.map((r) => ({ id: String(r.id), similarity: Number(r.similarity) }));
    }
    if (!scored.length) {
      const terms = input.query.trim().split(/\s+/).filter(Boolean);
      const pattern = terms.map((t) => `%${t}%`).join("|");
      const { rows } = await db().query(
        `SELECT id, 0.7::FLOAT8 AS similarity
         FROM memory_nodes
         WHERE kind IN ('memory','derived') AND status NOT IN ('revoked','quarantined','invalidated','cancelled')
           AND (label ILIKE ANY(ARRAY(SELECT '%' || unnest($2::STRING[]) || '%')) OR detail ILIKE ANY(ARRAY(SELECT '%' || unnest($2::STRING[]) || '%')))
         ORDER BY similarity DESC
         LIMIT $1`,
        [k, terms],
      );
      scored = rows.map((r) => ({ id: String(r.id), similarity: Number(r.similarity) }));
      if (scored.length === 0 && pattern) {
        const { rows: fallback } = await db().query(
          `SELECT id, 0.6::FLOAT8 AS similarity FROM memory_nodes WHERE kind IN ('memory','derived') AND status NOT IN ('revoked','quarantined','invalidated','cancelled') AND (label ILIKE $2 OR detail ILIKE $2) ORDER BY created_at DESC LIMIT $1`,
          [k, `%${input.query.trim()}%`],
        );
        scored = fallback.map((r) => ({ id: String(r.id), similarity: Number(r.similarity) }));
      }
    }
    const ids = scored.map((s) => s.id);
    const session = await this.getOrCreateSession(input.agentId);
    const result: RetrievedMemory[] = [];
    for (let i = 0; i < ids.length; i++) {
      const memory = await this.getMemory(ids[i]);
      if (!memory) continue;
      const event = await this.recordRetrievalEvent(input.agentId, memory.id, scored[i].similarity, input.query, input.context ?? {}, session.id);
      result.push({ memory, similarity: scored[i].similarity, eventId: event.id });
    }
    await this.audit("retrieval.executed", input.agentId, undefined, { query: input.query, matches: result.length, sessionId: session.id });
    return result;
  }

  private async recordRetrievalEvent(agentId: string, memoryId: string, similarity: number, queryText: string, context: Record<string, unknown>, sessionId: string): Promise<RetrievalEvent> {
    const eventId = shortId("rev");
    const { rows } = await db().query(
      `INSERT INTO retrieval_events (id, agent_id, memory_id, similarity, query_text, context, session_id) VALUES ($1,$2,$3,$4,$5,$6::JSONB,$7) RETURNING id, created_at`,
      [eventId, agentId, memoryId, similarity, queryText, JSON.stringify(context), sessionId],
    );
    return { id: eventId, agentId, memoryId, similarity, queryText, sessionId, context, createdAt: new Date(rows[0].created_at as string).toISOString() };
  }

  async listRetrievalEvents(limit: number, agentId?: string): Promise<RetrievalEvent[]> {
    const { rows } = await db().query(
      `SELECT id, agent_id, memory_id, similarity, query_text, decision_id, context, created_at FROM retrieval_events WHERE ($2::STRING IS NULL OR agent_id = $2) ORDER BY created_at DESC LIMIT $1`,
      [limit, agentId ?? null],
    );
    return rows.map((r) => ({
      id: String(r.id),
      agentId: String(r.agent_id),
      memoryId: String(r.memory_id),
      similarity: Number(r.similarity),
      queryText: String(r.query_text ?? ""),
      decisionId: r.decision_id != null ? String(r.decision_id) : undefined,
      sessionId: r.session_id != null ? String(r.session_id) : undefined,
      context: (r.context ?? {}) as Record<string, unknown>,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  async recordDecision(input: RecordDecisionInput): Promise<DecisionRecord> {
    if (input.idempotencyKey) {
      const prior = await this.getDecisionByKey(input.idempotencyKey);
      if (prior) return prior;
    }
    return withTransaction(async (query) => {
      const memoryIds = [...new Set(input.memoryIds)];
      const { rows: existing } = await query(`SELECT id, kind FROM memory_nodes WHERE id = ANY($1::STRING[])`, [memoryIds]);
      const found = new Map<string, string>((existing as { id: string; kind: string }[]).map((r) => [String(r.id), String(r.kind)]));
      const missing = memoryIds.filter((id) => !found.has(id) || !isMemoryKind(found.get(id) as NodeKind));
      if (missing.length) throw badRequest("Decision references unknown memory ids", { memoryIds: missing });

      const agentId = input.agentId;
      await query(`UPSERT INTO memory_nodes (id, kind, label, detail, content, content_hash, source_uri, status, trust) VALUES ($1, 'agent', $1, $1, $1, $1, 'urn:antidote:agent', 'trusted', 1.0)`, [agentId]);

      const decisionId = shortId("d");
      await query(
        `INSERT INTO memory_nodes (id, kind, label, detail, content, content_hash, source_uri, status, trust, metadata, idempotency_key)
         VALUES ($1, 'decision', $2, $3, $2, $4, 'urn:antidote:decision', 'trusted', 1.0, $5::JSONB, $6)`,
        [decisionId, input.summary, input.detail ?? input.summary, fnv1aHex(`${input.agentId}:${input.summary}`), JSON.stringify({ context: input.context ?? {} }), input.idempotencyKey ?? null],
      );
      await query(`INSERT INTO memory_edges (from_id, to_id, relation) VALUES ($1, $2, 'influenced') ON CONFLICT DO NOTHING`, [agentId, decisionId]);
      for (const memoryId of memoryIds) {
        await query(`INSERT INTO memory_edges (from_id, to_id, relation) VALUES ($1, $2, 'retrieved') ON CONFLICT DO NOTHING`, [memoryId, agentId]);
        await query(`INSERT INTO decision_inputs (decision_id, memory_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [decisionId, memoryId]);
        await query(`UPDATE retrieval_events SET decision_id = $1 WHERE agent_id = $2 AND memory_id = $3 AND decision_id IS NULL`, [decisionId, agentId, memoryId]);
      }
      await query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ('decision.recorded', $1, $2, $3::JSONB)`, [input.agentId, decisionId, JSON.stringify({ memoryIds })]);
      const now = new Date().toISOString();
      return { id: decisionId, agentId, memoryIds, summary: input.summary, detail: input.detail ?? input.summary, status: "trusted", createdAt: now };
    });
  }

  private async getDecisionByKey(idempotencyKey: string): Promise<DecisionRecord | null> {
    const { rows } = await db().query(`SELECT id, metadata FROM memory_nodes WHERE idempotency_key = $1 AND kind = 'decision'`, [idempotencyKey]);
    if (!rows.length) return null;
    return this.getDecision(String(rows[0].id));
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    const { rows } = await db().query(
      `SELECT n.id, n.label, n.detail, n.status, n.created_at,
              (SELECT e.from_id FROM memory_edges e WHERE e.to_id = n.id AND e.relation = 'influenced' LIMIT 1) AS agent_id,
              COALESCE(array_agg(di.memory_id ORDER BY di.memory_id) FILTER (WHERE di.memory_id IS NOT NULL), '{}'::STRING[]) AS memory_ids
       FROM memory_nodes n
       LEFT JOIN decision_inputs di ON di.decision_id = n.id
       WHERE n.id = $1 AND n.kind = 'decision'
       GROUP BY n.id`,
      [id],
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      agentId: String(row.agent_id ?? "unknown"),
      memoryIds: (row.memory_ids ?? []) as string[],
      summary: String(row.label),
      detail: String(row.detail),
      status: row.status as NodeStatus,
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async recordAction(input: RecordActionInput): Promise<ActionRecord> {
    if (input.idempotencyKey) {
      const { rows } = await db().query(`SELECT id FROM actions WHERE idempotency_key = $1`, [input.idempotencyKey]);
      if (rows.length) return (await this.getAction(String(rows[0].id)))!;
    }
    return withTransaction(async (query) => {
      const { rows: decisions } = await query(`SELECT id FROM memory_nodes WHERE id = $1 AND kind = 'decision'`, [input.decisionId]);
      if (!decisions.length) throw badRequest(`Decision ${input.decisionId} does not exist`);
      const actionId = shortId("act");
      const now = new Date().toISOString();
      const summary = input.summary ?? `${input.actionType} action`;
      await query(
        `INSERT INTO memory_nodes (id, kind, label, detail, content, content_hash, source_uri, status, trust, metadata)
         VALUES ($1, 'action', $2, $2, $3, $4, 'urn:antidote:action', 'trusted', 1.0, $5::JSONB)`,
        [actionId, summary, JSON.stringify(input.payload ?? {}), fnv1aHex(actionId), JSON.stringify({ actionType: input.actionType })],
      );
      await query(
        `INSERT INTO actions (id, decision_id, action_type, summary, payload, status, external_ref, idempotency_key)
         VALUES ($1, $2, $3, $4, $5::JSONB, 'pending', $6, $7)`,
        [actionId, input.decisionId, input.actionType, summary, JSON.stringify(input.payload ?? {}), input.externalRef ?? null, input.idempotencyKey ?? null],
      );
      await query(`INSERT INTO memory_edges (from_id, to_id, relation) VALUES ($1, $2, 'produced') ON CONFLICT DO NOTHING`, [input.decisionId, actionId]);
      await query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ('action.recorded', 'agent', $1, $2::JSONB)`, [actionId, JSON.stringify({ decisionId: input.decisionId, actionType: input.actionType })]);
      return { id: actionId, decisionId: input.decisionId, actionType: input.actionType, summary, payload: input.payload ?? {}, status: "pending", externalRef: input.externalRef, idempotencyKey: input.idempotencyKey, createdAt: now };
    });
  }

  async getAction(id: string): Promise<ActionRecord | null> {
    const { rows } = await db().query(`SELECT * FROM actions WHERE id = $1`, [id]);
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      decisionId: String(row.decision_id),
      actionType: String(row.action_type),
      summary: String(row.summary),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      status: row.status,
      externalRef: row.external_ref ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async recordDerivedMemory(input: RecordDerivedInput & { embedding: number[] }): Promise<MemoryRecord> {
    if (input.idempotencyKey) {
      const { rows } = await db().query(`SELECT id FROM memory_nodes WHERE idempotency_key = $1 AND kind = 'derived'`, [input.idempotencyKey]);
      if (rows.length) return (await this.getMemory(String(rows[0].id)))!;
    }
    return withTransaction(async (query) => {
      const { rows: decisions } = await query(`SELECT id FROM memory_nodes WHERE id = $1 AND kind = 'decision'`, [input.decisionId]);
      if (!decisions.length) throw badRequest(`Decision ${input.decisionId} does not exist`);
      const derivedId = shortId("m");
      await query(
        `INSERT INTO memory_nodes (id, kind, label, detail, content, content_hash, source_uri, status, trust, embedding, metadata, idempotency_key)
         VALUES ($1, 'derived', $2, $3, $4, $5, 'urn:antidote:decision', 'trusted', 0.9, $6::VECTOR, $7::JSONB, $8)`,
        [derivedId, input.label, input.detail, input.content ?? input.detail, fnv1aHex(`${input.decisionId}:${input.detail}`), toVector(input.embedding), JSON.stringify({ parentDecisionId: input.decisionId }), input.idempotencyKey ?? null],
      );
      await query(`INSERT INTO memory_edges (from_id, to_id, relation) VALUES ($1, $2, 'produced') ON CONFLICT DO NOTHING`, [input.decisionId, derivedId]);
      await query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ('derived.recorded', 'agent', $1, $2::JSONB)`, [derivedId, JSON.stringify({ parentDecisionId: input.decisionId })]);
      return (await query(`SELECT ${NODE_FIELDS} FROM memory_nodes WHERE id = $1`, [derivedId])).rows.map(rowToMemory)[0];
    });
  }

  async getCausalChain(memoryId: string): Promise<CausalChain> {
    const root = await this.getMemory(memoryId);
    if (!root) throw badRequest(`Memory ${memoryId} does not exist`);
    const { rows } = await db().query(
      `WITH RECURSIVE closure(id) AS (
         SELECT $1::STRING
         UNION ALL
         SELECT e.to_id FROM memory_edges e JOIN closure c ON e.from_id = c.id WHERE e.relation = ANY($2::STRING[])
       )
       SELECT c.id FROM closure c`,
      [memoryId, BLAST_RELATIONS],
    );
    const ids = new Set(rows.map((r) => String(r.id)));
    ids.add(memoryId);
    const { rows: createdRows } = await db().query(`SELECT from_id FROM memory_edges WHERE to_id = $1 AND relation = 'created'`, [memoryId]);
    for (const row of createdRows) ids.add(String(row.from_id));
    const nodes = (await this.listMemories()).filter((n) => ids.has(n.id));

    const retrievals = (await this.listRetrievalEvents(500)).filter((e) => ids.has(e.memoryId));
    const decisions: DecisionRecord[] = [];
    const actions: ActionRecord[] = [];
    const derived: MemoryRecord[] = [];
    for (const node of nodes) {
      if (node.kind === "decision") {
        const decision = await this.getDecision(node.id);
        if (decision) decisions.push(decision);
      } else if (node.kind === "action") {
        const action = await this.getAction(node.id);
        if (action) actions.push(action);
      } else if (node.kind === "derived") {
        derived.push(node);
      }
    }
    const idList = [...ids];
    const agentIds = nodes.filter((n) => n.kind === "agent").map((n) => n.id);
    const [sessions, verdicts, contaminations] = await Promise.all([
      agentIds.length ? db().query(`SELECT id, agent_id, status, metadata, started_at, ended_at FROM agent_sessions WHERE agent_id = ANY($1::STRING[])`, [agentIds]) : Promise.resolve({ rows: [] }),
      db().query(`SELECT id, memory_id, target_text, verdict, confidence, reason, model_id, payload, created_at FROM security_verdicts WHERE memory_id = ANY($1::STRING[])`, [idList]),
      db().query(`SELECT id, memory_id, verdict_id, severity, reason, detected_by, created_at FROM contamination_events WHERE memory_id = ANY($1::STRING[])`, [idList]),
    ]);
    return {
      rootMemoryId: memoryId,
      source: nodes.find((n) => n.kind === "source") ?? null,
      memory: root,
      retrievals,
      decisions,
      actions,
      derived,
      nodes,
      sessions: sessions.rows.map(rowToSession),
      verdicts: verdicts.rows.map(rowToVerdict),
      contaminations: contaminations.rows.map(rowToContamination),
    };
  }

  async getScenario(): Promise<Scenario> {
    const { rows: nodes } = await db().query(`SELECT ${NODE_FIELDS} FROM memory_nodes ORDER BY created_at ASC`);
    const { rows: edges } = await db().query(`SELECT id, from_id, to_id, relation FROM memory_edges`);
    const root = nodes.find((n) => n.kind === "memory" || n.kind === "derived");
    const plan = root ? await this.computeBlastRadius(String(root.id)) : { rootMemoryId: "", memoryIds: [], decisionIds: [], actionIds: [], needsReevaluation: [] };
    const rootNode = root ? rowToMemory(root) : null;
    const repaired = rootNode ? isRevokedStatus(rootNode.status) : false;
    const usedBy = new Map<string, number>();
    for (const edge of edges) {
      if (String(edge.relation) === "retrieved") {
        const from = String(edge.from_id);
        usedBy.set(from, (usedBy.get(from) ?? 0) + 1);
      }
    }
    const edgeList: { from: string; to: string; relation: string }[] = edges.map((e) => ({ from: String(e.from_id), to: String(e.to_id), relation: String(e.relation) }));
    const descendantCount = (id: string): number => {
      const closure = new Set<string>([id]);
      const queue = [id];
      while (queue.length) {
        const current = queue.shift()!;
        for (const edge of edgeList) {
          if (edge.from === current && BLAST_RELATIONS.includes(edge.relation as EdgeRelation) && !closure.has(edge.to)) {
            closure.add(edge.to);
            queue.push(edge.to);
          }
        }
      }
      const kinds = new Map(nodes.map((n) => [String(n.id), String(n.kind)]));
      return [...closure].filter((nid) => kinds.get(nid) !== "agent").length;
    };
    const rankOf = (id: string): number => {
      let rank = 0;
      let current = id;
      const seen = new Set<string>();
      while (current !== String(root?.id) && !seen.has(current)) {
        seen.add(current);
        const edge = edges.find((e) => String(e.to_id) === current);
        if (!edge) return rank + 1;
        current = String(edge.from_id);
        rank++;
      }
      return rank;
    };
    return {
      id: "live-graph",
      title: repaired ? "Containment complete" : "Active contamination detected",
      subtitle: repaired ? "Influence chain repaired; affected artifacts quarantined." : "A compromised source has influenced multiple autonomous decisions.",
      phase: repaired ? "repaired" : "infected",
      nodes: nodes.map((n) => {
        const memory = rowToMemory(n);
        const rank = rankOf(String(n.id));
        return {
          id: memory.id,
          kind: memory.kind,
          label: memory.label,
          detail: memory.detail,
          status: memory.status,
          trust: Math.round(memory.trust * 100),
          x: 90 + rank * 170,
          y: 80 + (nodes.indexOf(n) % 4) * 80,
          usedBy: usedBy.get(memory.id) ?? 0,
          descendants: descendantCount(memory.id),
        };
      }),
      edges: edges.map((e) => ({ id: String(e.id), from: String(e.from_id), to: String(e.to_id), relation: String(e.relation) as EdgeRelation })),
      blastRadius: { memories: plan.memoryIds.length + 1, decisions: plan.decisionIds.length, actions: plan.actionIds.length, agents: plan.needsReevaluation.length },
    };
  }

  async computeBlastRadius(rootMemoryId: string): Promise<RepairPlan> {
    const { rows: rootCheck } = await db().query(`SELECT 1 FROM memory_nodes WHERE id = $1`, [rootMemoryId]);
    if (!rootCheck.length) throw badRequest(`Memory ${rootMemoryId} does not exist`);
    // UNION (set semantics) + depth bound protects against cyclic dependency
    // graphs while capturing depth for the simulation view.
    const { rows } = await db().query(
      `WITH RECURSIVE blast(id, depth, path) AS (
         SELECT $1::STRING, 0::INT, ARRAY[$1::STRING]::STRING[]
         UNION ALL
         SELECT e.to_id, b.depth + 1, array_append(b.path, e.to_id)
         FROM memory_edges e
         JOIN blast b ON e.from_id = b.id
         WHERE e.relation = ANY($2::STRING[])
           AND b.depth < 99
           AND NOT e.to_id = ANY(b.path)
       ), bounded AS (
         SELECT id, min(depth)::INT AS depth
         FROM blast
         GROUP BY id
         ORDER BY depth, id
         LIMIT 100
       )
       SELECT n.id, n.kind, n.status, b.depth
       FROM bounded b JOIN memory_nodes n ON n.id = b.id`,
      [rootMemoryId, [...BLAST_RELATIONS, "created"]],
    );
    const nodes: RepairPlanNode[] = rows.map((r) => ({ id: String(r.id), kind: String(r.kind) as NodeKind, status: String(r.status) as NodeStatus, depth: Number(r.depth) }));
    const kinds = new Map(nodes.map((n) => [n.id, n.kind]));
    const statuses = new Map(nodes.map((n) => [n.id, n.status]));
    const ids = nodes.map((n) => n.id);
    const { rows: edges } = await db().query(`SELECT from_id, to_id, relation FROM memory_edges WHERE from_id = ANY($1::STRING[]) AND to_id = ANY($1::STRING[])`, [ids]);
    const { rows: actionRows } = await db().query(`SELECT id, status FROM actions WHERE id = ANY($1::STRING[])`, [ids]);
    const actionStatuses = new Map(actionRows.map((r) => [String(r.id), String(r.status)]));
    const { rows: retrievalRows } = await db().query(`SELECT id FROM retrieval_events WHERE memory_id = ANY($1::STRING[])`, [ids]);
    const { rows: evidenceRows } = await db().query(`SELECT id, memory_id, evidence_uri FROM revocations WHERE memory_id = ANY($1::STRING[])`, [ids]);
    const { rows: decisionRows } = await db().query(
      `SELECT n.id, (SELECT e.from_id FROM memory_edges e WHERE e.to_id = n.id AND e.relation = 'influenced' LIMIT 1) AS agent_id
       FROM memory_nodes n WHERE n.id = ANY($1::STRING[]) AND n.kind = 'decision'`,
      [ids],
    );
    const memoryIds = [...kinds].filter(([, kind]) => isMemoryKind(kind)).map(([id]) => id).filter((id) => id !== rootMemoryId);
    const actionIds = [...kinds].filter(([, kind]) => kind === "action").map(([id]) => id);
    const reevaluations: PlanReevaluation[] = decisionRows.map((r) => ({
      agentId: String(r.agent_id ?? "unknown"),
      decisionId: String(r.id),
      reason: `decision invalidated by repair of ${rootMemoryId}`,
    }));
    return {
      rootMemoryId,
      memoryIds,
      derivedMemoryIds: memoryIds.filter((id) => kinds.get(id) === "derived"),
      decisionIds: [...kinds].filter(([, kind]) => kind === "decision").map(([id]) => id),
      actionIds,
      cancelActionIds: actionIds.filter((id) => (actionStatuses.get(id) ?? statuses.get(id)) === "pending"),
      reviewActionIds: actionIds.filter((id) => ["completed", "executing"].includes(actionStatuses.get(id) ?? statuses.get(id) ?? "")),
      needsReevaluation: [...kinds].filter(([, kind]) => kind === "agent").map(([id]) => id),
      retrievalEventIds: retrievalRows.map((r) => String(r.id)),
      evidence: evidenceRows.map((r) => ({ id: String(r.id), memoryId: String(r.memory_id), uri: r.evidence_uri != null ? String(r.evidence_uri) : undefined })),
      reevaluations,
      graph: {
        nodes,
        edges: edges.map((e) => ({ from: String(e.from_id), to: String(e.to_id), relation: String(e.relation) as EdgeRelation })),
      },
    };
  }

  async executeRepair(input: ExecuteRepairInput): Promise<RepairResult> {
    const { plan, reason, actor, evidenceUri } = input;
    const planHash = planHashOf(plan);
    return withTransaction(
      async (query) => {
        // Serialize concurrent repairs of the same root memory on its row lock.
        const { rows: rootRows } = await query(`SELECT id FROM memory_nodes WHERE id = $1 FOR UPDATE`, [plan.rootMemoryId]);
        if (!rootRows.length) throw badRequest(`Memory ${plan.rootMemoryId} does not exist`);

        // Idempotent replay: a completed repair for the same root + plan is not re-executed.
        const prior = await query(`SELECT id, completed_at FROM repair_jobs WHERE root_memory_id = $1 AND plan_hash = $2 AND status = 'completed'`, [plan.rootMemoryId, planHash]);
        if (prior.rows.length) {
          const row = prior.rows[0] as { id: string; completed_at: string };
          const { rows: reEvals } = await query(`SELECT id FROM re_evaluations WHERE memory_id = $1`, [plan.rootMemoryId]);
          return { repairId: row.id, status: "completed", executed: false, ...plan, reEvaluationIds: reEvals.map((r) => String(r.id)), repairedAt: new Date(row.completed_at).toISOString() };
        }
        // A root already repaired by any completed repair job replays too: its
        // influence was fully revoked; a follow-up call has nothing new to do.
        const rootCheck = await query(`SELECT status FROM memory_nodes WHERE id = $1`, [plan.rootMemoryId]);
        const priorAny = await query(`SELECT id, completed_at FROM repair_jobs WHERE root_memory_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [plan.rootMemoryId]);
        if (rootCheck.rows.length && String(rootCheck.rows[0].status) === "repaired" && priorAny.rows.length) {
          const row = priorAny.rows[0] as { id: string; completed_at: string };
          return { repairId: row.id, status: "completed", executed: false, ...plan, reEvaluationIds: [], repairedAt: new Date(row.completed_at).toISOString() };
        }

        const repairId = shortId("repair");
        await query(`INSERT INTO repair_jobs (id, root_memory_id, status, actor, reason, plan, plan_hash) VALUES ($1, $2, 'running', $3, $4, $5::JSONB, $6)`, [repairId, plan.rootMemoryId, actor ?? "security-agent", reason ?? null, JSON.stringify(plan), planHash]);

        // 1) Revoke the root memory (preserve the row: status + reasons only).
        await query(`UPDATE memory_nodes SET status = 'repaired', status_reason = $2, revoked_at = now(), repaired_at = now(), updated_at = now() WHERE id = $1`, [plan.rootMemoryId, reason ?? "memory integrity failure"]);

        // 2) Quarantine dependent memories; mark the whole closure as repaired.
        if (plan.memoryIds.length) {
          await query(`UPDATE memory_nodes SET status = 'quarantined', status_reason = $2, repaired_at = now(), updated_at = now() WHERE id = ANY($1::STRING[]) AND id <> $3`, [plan.memoryIds, reason ?? "quarantined by repair", plan.rootMemoryId]);
        }

        // 3) Invalidate decisions that depended materially on the root.
        if (plan.decisionIds.length) {
          await query(`UPDATE memory_nodes SET status = 'invalidated', status_reason = $2, repaired_at = now(), updated_at = now() WHERE id = ANY($1::STRING[])`, [plan.decisionIds, reason ?? "decision inputs revoked"]);
        }

        // 4) Cancel still-pending actions; flag completed/executing actions for
        //    human remediation (irreversible outcomes cannot be undone).
        if (plan.cancelActionIds.length) {
          await query(`UPDATE memory_nodes SET status = 'cancelled', status_reason = $2, repaired_at = now(), updated_at = now() WHERE id = ANY($1::STRING[])`, [plan.cancelActionIds, reason ?? "action cancelled by repair"]);
          await query(`UPDATE actions SET status = 'cancelled', updated_at = now() WHERE id = ANY($1::STRING[])`, [plan.cancelActionIds]);
        }
        if (plan.reviewActionIds.length) {
          await query(`UPDATE memory_nodes SET status = 'requires_review', status_reason = $2, repaired_at = now(), updated_at = now() WHERE id = ANY($1::STRING[])`, [plan.reviewActionIds, reason ?? "irreversible action completed before repair; human remediation required"]);
          await query(`UPDATE actions SET status = 'requires_review', updated_at = now() WHERE id = ANY($1::STRING[])`, [plan.reviewActionIds]);
        }

        // 5) Enqueue affected cases for re-evaluation.
        const reEvaluationIds: string[] = [];
        for (const re of plan.reevaluations) {
          const { rows: inserted } = await query(
            `INSERT INTO re_evaluations (memory_id, agent_id, decision_id, reason) VALUES ($1, $2, $3, $4) RETURNING id`,
            [plan.rootMemoryId, re.agentId, re.decisionId ?? null, re.reason],
          );
          reEvaluationIds.push(String(inserted[0].id));
        }

        // 6) Immutable revocation + contamination records; audit trail.
        const revocation = await query(`INSERT INTO revocations (memory_id, reason, actor, evidence_uri) VALUES ($1, $2, $3, $4) RETURNING id`, [plan.rootMemoryId, reason ?? "memory integrity failure", actor ?? "security-agent", evidenceUri ?? null]);
        const revocationId = String(revocation.rows[0].id);
        await query(`INSERT INTO contamination_events (memory_id, severity, reason, detected_by) VALUES ($1, 'critical', $2, $3)`, [plan.rootMemoryId, reason ?? "confirmed memory poisoning", actor ?? "security-agent"]);
        await query(`UPDATE repair_jobs SET status = 'completed', completed_at = now() WHERE id = $1`, [repairId]);
        await query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ('repair.completed', $1, $2, $3::JSONB)`, [actor ?? "security-agent", repairId, JSON.stringify({ rootMemoryId: plan.rootMemoryId, plan, planHash, revocationId, reEvaluationIds })]);
        return { repairId, status: "completed", executed: true, ...plan, reEvaluationIds, revocationId, repairedAt: new Date().toISOString() };
      },
      { isolation: "serializable", retries: 4 },
    );
  }

  async recordRevocation(input: RevocationInput): Promise<RevocationRecord> {
    const { rows } = await db().query(`INSERT INTO revocations (memory_id, reason, actor, evidence_uri) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [input.memoryId, input.reason, input.actor, input.evidenceUri ?? null]);
    return { id: String(rows[0].id), memoryId: input.memoryId, reason: input.reason, actor: input.actor, evidenceUri: input.evidenceUri, createdAt: new Date(rows[0].created_at as string).toISOString() };
  }

  async audit(eventType: string, actor: string, objectId: string | undefined, payload: Record<string, unknown>): Promise<void> {
    await db().query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ($1, $2, $3, $4::JSONB)`, [eventType, actor, objectId ?? null, JSON.stringify(payload)]);
  }

  async getOrCreateSession(agentId: string, metadata?: Record<string, unknown>): Promise<AgentSession> {
    const { rows } = await db().query(`SELECT id, agent_id, status, metadata, started_at, ended_at FROM agent_sessions WHERE agent_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`, [agentId]);
    if (rows.length) return rowToSession(rows[0]);
    try {
      const sessionId = shortId("sess");
      const { rows: inserted } = await db().query(`INSERT INTO agent_sessions (id, agent_id, metadata) VALUES ($1, $2, $3::JSONB) RETURNING id, agent_id, status, metadata, started_at, ended_at`, [sessionId, agentId, JSON.stringify(metadata ?? {})]);
      return rowToSession(inserted[0]);
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        const { rows: retried } = await db().query(`SELECT id, agent_id, status, metadata, started_at, ended_at FROM agent_sessions WHERE agent_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`, [agentId]);
        if (retried.length) return rowToSession(retried[0]);
      }
      throw error;
    }
  }

  async startFreshSession(agentId: string, metadata?: Record<string, unknown>): Promise<AgentSession> {
    return withTransaction(async (query) => {
      await query(`UPDATE agent_sessions SET status = 'closed', ended_at = now() WHERE agent_id = $1 AND status = 'active'`, [agentId]);
      const sessionId = shortId("sess");
      const { rows } = await query(`INSERT INTO agent_sessions (id, agent_id, metadata) VALUES ($1, $2, $3::JSONB) RETURNING id, agent_id, status, metadata, started_at, ended_at`, [sessionId, agentId, JSON.stringify(metadata ?? {})]);
      await query(`INSERT INTO audit_events (event_type, actor, object_id, payload) VALUES ('agent.session.refreshed', $1, $2, $3::JSONB)`, [agentId, sessionId, JSON.stringify(metadata ?? {})]);
      return rowToSession(rows[0]);
    }, { isolation: "serializable" });
  }

  async listSessions(limit = 100): Promise<AgentSession[]> {
    const { rows } = await db().query(`SELECT id, agent_id, status, metadata, started_at, ended_at FROM agent_sessions ORDER BY started_at DESC LIMIT $1`, [limit]);
    return rows.map(rowToSession);
  }

  async recordSecurityVerdict(input: RecordVerdictInput): Promise<SecurityVerdict> {
    const { rows } = await db().query(
      `INSERT INTO security_verdicts (memory_id, target_text, verdict, confidence, reason, model_id, payload) VALUES ($1,$2,$3,$4,$5,$6,$7::JSONB) RETURNING id, created_at`,
      [input.memoryId ?? null, input.targetText, input.verdict, input.confidence, input.reason ?? null, input.modelId ?? null, JSON.stringify(input.payload ?? {})],
    );
    const id = String(rows[0].id);
    await this.audit("verdict.recorded", "security-verifier", input.memoryId ?? id, { verdict: input.verdict, confidence: input.confidence });
    return { id, memoryId: input.memoryId, targetText: input.targetText, verdict: input.verdict, confidence: input.confidence, reason: input.reason, modelId: input.modelId, payload: input.payload ?? {}, createdAt: new Date(rows[0].created_at as string).toISOString() };
  }

  async listSecurityVerdicts(limit = 100): Promise<SecurityVerdict[]> {
    const { rows } = await db().query(`SELECT id, memory_id, target_text, verdict, confidence, reason, model_id, payload, created_at FROM security_verdicts ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map(rowToVerdict);
  }

  async recordContamination(input: RecordContaminationInput): Promise<ContaminationEvent> {
    const { rows } = await db().query(
      `INSERT INTO contamination_events (memory_id, verdict_id, severity, reason, detected_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [input.memoryId, input.verdictId ?? null, input.severity ?? "high", input.reason ?? null, input.detectedBy],
    );
    const id = String(rows[0].id);
    await this.audit("contamination.recorded", input.detectedBy, input.memoryId, { severity: input.severity ?? "high", reason: input.reason });
    return { id, memoryId: input.memoryId, verdictId: input.verdictId, severity: input.severity ?? "high", reason: input.reason, detectedBy: input.detectedBy, createdAt: new Date(rows[0].created_at as string).toISOString() };
  }

  async listContaminationEvents(limit = 100): Promise<ContaminationEvent[]> {
    const { rows } = await db().query(`SELECT id, memory_id, verdict_id, severity, reason, detected_by, created_at FROM contamination_events ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map(rowToContamination);
  }

  async recordAttackMemory(input: RecordAttackInput): Promise<AttackMemory> {
    const { rows } = await db().query(
      `INSERT INTO attack_memories (pattern, "family", embedding, memory_id, revocation_id, actor, affected_entities, source_characteristics, attack_method, verdict, verdict_confidence, verdict_reason, repair_id, provenance)
       VALUES ($1,$2,$3::VECTOR,$4,$5,$6,$7::STRING[],$8::JSONB,$9,$10,$11,$12,$13,$14::JSONB) RETURNING id, created_at`,
      [
        input.pattern,
        input.family ?? "unknown",
        toVector(input.embedding),
        input.memoryId ?? null,
        input.revocationId ?? null,
        input.actor,
        input.affectedEntities ?? null,
        input.sourceCharacteristics != null ? JSON.stringify(input.sourceCharacteristics) : null,
        input.attackMethod ?? null,
        input.verdict ?? null,
        input.verdictConfidence ?? null,
        input.verdictReason ?? null,
        input.repairId ?? null,
        input.provenance != null ? JSON.stringify(input.provenance) : null,
      ],
    );
    const id = String(rows[0].id);
    await this.audit("attack.recorded", input.actor, id, { family: input.family ?? "unknown", memoryId: input.memoryId });
    return {
      id,
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
      createdAt: new Date(rows[0].created_at as string).toISOString(),
    };
  }

  async listAttackMemories(limit = 100): Promise<AttackMemory[]> {
    const { rows } = await db().query(
      `SELECT id, pattern, "family", memory_id, revocation_id, actor, affected_entities, source_characteristics, attack_method, verdict, verdict_confidence, verdict_reason, repair_id, provenance, created_at
       FROM attack_memories ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(rowToAttack);
  }

  async listReEvaluations(limit = 100): Promise<ReEvaluation[]> {
    const { rows } = await db().query(`SELECT id, memory_id, agent_id, decision_id, reason, status, attempt_count, result, error, replacement_decision_id, created_at, started_at, completed_at, failed_at FROM re_evaluations ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map(rowToReEvaluation);
  }

  async startReEvaluation(id: string): Promise<ReEvaluation | null> {
    const { rows } = await db().query(`UPDATE re_evaluations SET status = 'running', started_at = now(), attempt_count = attempt_count + 1, error = NULL WHERE id = $1 AND status IN ('pending','failed') RETURNING id, memory_id, agent_id, decision_id, reason, status, attempt_count, result, error, replacement_decision_id, created_at, started_at, completed_at, failed_at`, [id]);
    if (!rows.length) return null;
    const record = rowToReEvaluation(rows[0]);
    await this.audit("reevaluation.started", "repair-worker", record.id, { agentId: record.agentId, decisionId: record.decisionId, attemptCount: record.attemptCount });
    return record;
  }

  async completeReEvaluation(id: string, result: Record<string, unknown> = {}, replacementDecisionId?: string): Promise<ReEvaluation | null> {
    const { rows } = await db().query(`UPDATE re_evaluations SET status = 'completed', result = $2::JSONB, replacement_decision_id = $3, error = NULL, completed_at = now() WHERE id = $1 RETURNING id, memory_id, agent_id, decision_id, reason, status, attempt_count, result, error, replacement_decision_id, created_at, started_at, completed_at, failed_at`, [id, JSON.stringify(result), replacementDecisionId ?? null]);
    if (!rows.length) return null;
    const record = rowToReEvaluation(rows[0]);
    await this.audit("reevaluation.completed", "repair-worker", record.id, { agentId: record.agentId, decisionId: record.decisionId, replacementDecisionId, result });
    return record;
  }

  async failReEvaluation(id: string, error: string): Promise<ReEvaluation | null> {
    const { rows } = await db().query(`UPDATE re_evaluations SET status = 'failed', error = $2, failed_at = now() WHERE id = $1 RETURNING id, memory_id, agent_id, decision_id, reason, status, attempt_count, result, error, replacement_decision_id, created_at, started_at, completed_at, failed_at`, [id, error]);
    if (!rows.length) return null;
    const record = rowToReEvaluation(rows[0]);
    await this.audit("reevaluation.failed", "repair-worker", record.id, { agentId: record.agentId, decisionId: record.decisionId, error });
    return record;
  }

  async listRepairJobs(limit = 100): Promise<RepairJob[]> {
    const { rows } = await db().query(`SELECT id, root_memory_id, status, actor, reason, created_at, completed_at FROM repair_jobs ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({
      id: String(r.id),
      rootMemoryId: String(r.root_memory_id),
      status: String(r.status),
      actor: r.actor != null ? String(r.actor) : undefined,
      reason: r.reason != null ? String(r.reason) : undefined,
      createdAt: new Date(r.created_at as string).toISOString(),
      completedAt: r.completed_at != null ? new Date(r.completed_at as string).toISOString() : undefined,
    }));
  }

  async recordMcpOperation(input: { agentId: string; capability: McpCapability; params: Record<string, unknown>; status: "completed" | "failed"; durationMs: number; result?: unknown; error?: string }): Promise<McpOperation> {
    const { rows } = await db().query(
      `INSERT INTO mcp_operations (agent_id, capability, params, status, duration_ms, result, error) VALUES ($1,$2,$3::JSONB,$4,$5,$6::JSONB,$7) RETURNING id, created_at`,
      [input.agentId, input.capability, JSON.stringify(input.params), input.status, input.durationMs, input.result != null ? JSON.stringify(input.result) : null, input.error ?? null],
    );
    return { id: String(rows[0].id), agentId: input.agentId, capability: input.capability, params: input.params, status: input.status, durationMs: input.durationMs, result: input.result, error: input.error, createdAt: new Date(rows[0].created_at as string).toISOString() };
  }

  async listMcpOperations(limit = 100, agentId?: string): Promise<McpOperation[]> {
    const { rows } = await db().query(`SELECT id, agent_id, capability, params, status, duration_ms, result, error, created_at FROM mcp_operations WHERE ($2::STRING IS NULL OR agent_id = $2) ORDER BY created_at DESC LIMIT $1`, [limit, agentId ?? null]);
    return rows.map((r) => ({
      id: String(r.id),
      agentId: String(r.agent_id),
      capability: r.capability as McpCapability,
      params: (r.params ?? {}) as Record<string, unknown>,
      status: r.status as McpOperation["status"],
      durationMs: Number(r.duration_ms ?? 0),
      result: r.result ?? undefined,
      error: r.error != null ? String(r.error) : undefined,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  async listAuditEvents(limit = 200): Promise<AuditEvent[]> {
    const { rows } = await db().query(`SELECT id, event_type, actor, object_id, payload, created_at FROM audit_events ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({
      id: String(r.id),
      eventType: String(r.event_type),
      actor: String(r.actor),
      objectId: r.object_id != null ? String(r.object_id) : undefined,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  async matchPoisonPatterns(queryEmbedding: number[], k = 3, minSimilarity = 0.6): Promise<AttackMemoryMatch[]> {
    const { rows } = await db().query(
      `SELECT id, pattern, "family", memory_id, revocation_id, actor, affected_entities, source_characteristics, attack_method, verdict, verdict_confidence, verdict_reason, repair_id, provenance, created_at,
              1 - (embedding <=> $1::VECTOR) AS similarity
       FROM attack_memories
       WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1::VECTOR) >= $2
       ORDER BY embedding <=> $1::VECTOR
       LIMIT $3`,
      [toVector(queryEmbedding), minSimilarity, k],
    );
    return rows.map((r) => ({ attack: rowToAttack(r), similarity: Number(r.similarity) }));
  }

  async getDependencies(input: DependencyQuery): Promise<Dependency[]> {
    const { rows } = await db().query(
      `WITH RECURSIVE dep(id, depth, relation, relation_from, kind, label) AS (
         SELECT n.id, 0::INT, ''::STRING, ''::STRING, n.kind, n.label FROM memory_nodes n WHERE n.id = $1
         UNION ALL
         SELECT CASE WHEN $2 = 'down' THEN e.to_id ELSE e.from_id END,
                d.depth + 1,
                e.relation,
                CASE WHEN $2 = 'down' THEN e.from_id ELSE e.to_id END,
                n.kind,
                n.label
         FROM dep d
         JOIN memory_edges e ON CASE WHEN $2 = 'down' THEN e.from_id = d.id ELSE e.to_id = d.id END
         JOIN memory_nodes n ON n.id = CASE WHEN $2 = 'down' THEN e.to_id ELSE e.from_id END
         WHERE e.relation = ANY($3::STRING[]) AND d.depth < $4
       )
       SELECT DISTINCT id, kind, label, depth, relation, relation_from FROM dep WHERE depth > 0 ORDER BY depth, id`,
      [input.memoryId, input.direction, input.relations ?? BLAST_RELATIONS, input.maxDepth ?? 10],
    );
    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind as NodeKind,
      label: String(r.label),
      depth: Number(r.depth),
      relation: r.relation as EdgeRelation,
      relationFrom: String(r.relation_from),
    }));
  }
}

function rowToSession(row: Record<string, unknown>): AgentSession {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    status: row.status as AgentSession["status"],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    startedAt: new Date(row.started_at as string).toISOString(),
    endedAt: row.ended_at != null ? new Date(row.ended_at as string).toISOString() : undefined,
  };
}

function rowToVerdict(row: Record<string, unknown>): SecurityVerdict {
  return {
    id: String(row.id),
    memoryId: row.memory_id != null ? String(row.memory_id) : undefined,
    targetText: String(row.target_text),
    verdict: row.verdict as SecurityVerdict["verdict"],
    confidence: Number(row.confidence),
    reason: row.reason != null ? String(row.reason) : undefined,
    modelId: row.model_id != null ? String(row.model_id) : undefined,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToContamination(row: Record<string, unknown>): ContaminationEvent {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    verdictId: row.verdict_id != null ? String(row.verdict_id) : undefined,
    severity: row.severity as ContaminationEvent["severity"],
    reason: row.reason != null ? String(row.reason) : undefined,
    detectedBy: String(row.detected_by),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToReEvaluation(row: Record<string, unknown>): ReEvaluation {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    agentId: String(row.agent_id),
    decisionId: row.decision_id != null ? String(row.decision_id) : undefined,
    reason: row.reason != null ? String(row.reason) : undefined,
    status: row.status as ReEvaluation["status"],
    attemptCount: Number(row.attempt_count ?? 0),
    result: row.result != null ? (row.result as Record<string, unknown>) : undefined,
    error: row.error != null ? String(row.error) : undefined,
    replacementDecisionId: row.replacement_decision_id != null ? String(row.replacement_decision_id) : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    startedAt: row.started_at != null ? new Date(row.started_at as string).toISOString() : undefined,
    completedAt: row.completed_at != null ? new Date(row.completed_at as string).toISOString() : undefined,
    failedAt: row.failed_at != null ? new Date(row.failed_at as string).toISOString() : undefined,
  };
}

function rowToAttack(row: Record<string, unknown>): AttackMemory {
  return {
    id: String(row.id),
    pattern: String(row.pattern),
    family: String(row.family),
    memoryId: row.memory_id != null ? String(row.memory_id) : undefined,
    revocationId: row.revocation_id != null ? String(row.revocation_id) : undefined,
    actor: String(row.actor),
    affectedEntities: row.affected_entities != null ? (row.affected_entities as string[]) : undefined,
    sourceCharacteristics: row.source_characteristics != null ? (row.source_characteristics as Record<string, unknown>) : undefined,
    attackMethod: row.attack_method != null ? String(row.attack_method) : undefined,
    verdict: row.verdict != null ? (row.verdict as AttackMemory["verdict"]) : undefined,
    verdictConfidence: row.verdict_confidence != null ? Number(row.verdict_confidence) : undefined,
    verdictReason: row.verdict_reason != null ? String(row.verdict_reason) : undefined,
    repairId: row.repair_id != null ? String(row.repair_id) : undefined,
    provenance: row.provenance != null ? (row.provenance as Record<string, unknown>) : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}
