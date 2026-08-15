-- ANTIDOTE CockroachDB schema: composed snapshot.
-- Source of truth: db/migrations/ (applied via `npm run migrate`).
-- CockroachDB v25.4+ recommended for GA vector indexing.

-- ══════════ 0001_initial.sql ══════════
-- ANTIDOTE initial schema
-- CockroachDB v25.4+ recommended for GA vector indexing.
-- Applied by `npm run migrate` (scripts/migrate.mjs); kept in sync with db/schema.sql.

CREATE TABLE IF NOT EXISTS memory_nodes (
  id STRING PRIMARY KEY,
  kind STRING NOT NULL CHECK (kind IN ('source','memory','agent','decision','action','derived')),
  label STRING NOT NULL,
  detail STRING NOT NULL,
  content STRING,
  status STRING NOT NULL DEFAULT 'trusted',
  trust DECIMAL(5,4) NOT NULL DEFAULT 1.0,
  content_hash STRING,
  source_uri STRING,
  embedding VECTOR(1024),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key STRING,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_nodes_content_hash_key
ON memory_nodes (content_hash) WHERE kind IN ('source','memory');

CREATE UNIQUE INDEX IF NOT EXISTS memory_nodes_idempotency_key_idx
ON memory_nodes (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE VECTOR INDEX IF NOT EXISTS memory_embedding_idx
ON memory_nodes (embedding) WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS memory_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  to_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  relation STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id, relation)
);
CREATE INDEX IF NOT EXISTS memory_edges_from_idx ON memory_edges(from_id);
CREATE INDEX IF NOT EXISTS memory_edges_to_idx ON memory_edges(to_id);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id STRING PRIMARY KEY,
  idempotency_key STRING UNIQUE,
  source_uri STRING NOT NULL,
  content_hash STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'running',
  actor STRING,
  stats JSONB,
  result JSONB,
  error STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS retrieval_events (
  id STRING PRIMARY KEY,
  agent_id STRING NOT NULL,
  memory_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  similarity DECIMAL(7,6),
  query_text STRING,
  decision_id STRING REFERENCES memory_nodes(id) ON DELETE CASCADE,
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retrieval_events_agent_idx ON retrieval_events(agent_id);
CREATE INDEX IF NOT EXISTS retrieval_events_memory_idx ON retrieval_events(memory_id);
CREATE INDEX IF NOT EXISTS retrieval_events_decision_idx ON retrieval_events(decision_id);

CREATE TABLE IF NOT EXISTS decision_inputs (
  decision_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  memory_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (decision_id, memory_id)
);

CREATE TABLE IF NOT EXISTS actions (
  id STRING PRIMARY KEY,
  decision_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  action_type STRING NOT NULL,
  summary STRING NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status STRING NOT NULL DEFAULT 'pending',
  external_ref STRING,
  idempotency_key STRING UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  reason STRING NOT NULL,
  evidence_uri STRING,
  actor STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revocations_memory_idx ON revocations(memory_id);

CREATE TABLE IF NOT EXISTS repair_jobs (
  id STRING PRIMARY KEY,
  root_memory_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  status STRING NOT NULL,
  actor STRING,
  reason STRING,
  plan JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type STRING NOT NULL,
  actor STRING NOT NULL,
  object_id STRING,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS audit_events_object_idx ON audit_events(object_id);

-- ══════════ 0002_infrastructure.sql ══════════
-- ANTIDOTE production infrastructure (migration 2)
-- Adds: agent sessions, security verdicts, contamination events, attack memories
-- (known poison patterns, vector searchable), dependency edges, and schema
-- hardening for the existing 0001 tables.
-- Requires CockroachDB v25.4+ for GA vector indexing.

-- ── Agent sessions ────────────────────────────────────────────────────────────
-- One active session per agent; retrieval events and decisions link to sessions.
CREATE TABLE IF NOT EXISTS agent_sessions (
  id STRING PRIMARY KEY,
  agent_id STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_active_idx
ON agent_sessions (agent_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS agent_sessions_agent_idx ON agent_sessions (agent_id);
CREATE INDEX IF NOT EXISTS agent_sessions_started_idx ON agent_sessions (started_at DESC);

-- ── Security verdicts ─────────────────────────────────────────────────────────
-- Immutable records of memory-security classification (Bedrock or operator).
CREATE TABLE IF NOT EXISTS security_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id STRING REFERENCES memory_nodes(id) ON DELETE SET NULL,
  target_text STRING NOT NULL,
  verdict STRING NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  reason STRING,
  model_id STRING,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_verdicts_memory_idx ON security_verdicts (memory_id);
CREATE INDEX IF NOT EXISTS security_verdicts_created_idx ON security_verdicts (created_at DESC);

-- ── Contamination events ──────────────────────────────────────────────────────
-- When a memory transitions into suspect/revoked state and why.
CREATE TABLE IF NOT EXISTS contamination_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  verdict_id UUID REFERENCES security_verdicts(id) ON DELETE SET NULL,
  severity STRING NOT NULL DEFAULT 'high',
  reason STRING,
  detected_by STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contamination_events_memory_idx ON contamination_events (memory_id);
CREATE INDEX IF NOT EXISTS contamination_events_created_idx ON contamination_events (created_at DESC);

-- ── Attack memories (known poison patterns) ───────────────────────────────────
-- Confirmed poisoning attempts become vector-searchable patterns so semantic
-- recall can recognize similar attacks at retrieval time.
CREATE TABLE IF NOT EXISTS attack_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern STRING NOT NULL,
  "family" STRING NOT NULL DEFAULT 'unknown',
  embedding VECTOR(1024),
  memory_id STRING REFERENCES memory_nodes(id) ON DELETE SET NULL,
  revocation_id UUID REFERENCES revocations(id) ON DELETE SET NULL,
  actor STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VECTOR INDEX IF NOT EXISTS attack_memories_embedding_idx
ON attack_memories (embedding) WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS attack_memories_family_idx ON attack_memories ("family");
CREATE INDEX IF NOT EXISTS attack_memories_created_idx ON attack_memories (created_at DESC);

-- ── Schema hardening for 0001 tables ──────────────────────────────────────────

-- Provenance: point each node at its originating source node (in addition to
-- the source_uri string) so source lineage is a first-class FK relationship.
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS source_id STRING;

ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS status_reason STRING;

ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_kind_chk
  CHECK (kind IN ('source','memory','agent','decision','action','derived'));
ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_status_chk
  CHECK (status IN ('trusted','suspect','revoked','quarantined','invalidated','cancelled'));
ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_source_fk
  FOREIGN KEY (source_id) REFERENCES memory_nodes(id) ON DELETE SET NULL;

-- Dependencies: edges carry a weight and structured metadata; relation values
-- are constrained to the known causal vocabulary.
ALTER TABLE memory_edges ADD COLUMN IF NOT EXISTS weight DECIMAL(5,4);
ALTER TABLE memory_edges ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE memory_edges ADD CONSTRAINT memory_edges_relation_chk
  CHECK (relation IN ('created','retrieved','influenced','produced','derived','dependency'));

CREATE INDEX IF NOT EXISTS memory_edges_from_relation_idx ON memory_edges (from_id, relation);
CREATE INDEX IF NOT EXISTS memory_edges_to_relation_idx ON memory_edges (to_id, relation);

-- Retrieval events belong to a session when one is active.
ALTER TABLE retrieval_events ADD COLUMN IF NOT EXISTS session_id STRING;
ALTER TABLE retrieval_events ADD CONSTRAINT retrieval_events_session_fk
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL;

-- Actions and repair jobs get explicit status constraints.
ALTER TABLE actions ADD CONSTRAINT actions_status_chk
  CHECK (status IN ('pending','executing','completed','cancelled','failed'));
ALTER TABLE actions ADD CONSTRAINT actions_type_chk CHECK (action_type <> '');

-- Repair idempotency: a completed repair for the same root memory + plan hash
-- is a replay, not a new operation. Concurrency is serialized on the root row.
ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS plan_hash STRING;
ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS error STRING;

CREATE UNIQUE INDEX IF NOT EXISTS repair_jobs_completed_plan_idx
ON repair_jobs (root_memory_id, plan_hash) WHERE status = 'completed';

-- ══════════ 0003_recovery_vocabulary.sql ══════════
-- ANTIDOTE recovery vocabulary (migration 3)
-- Full status lifecycle: ACTIVE(trusted) → SUSPECT → QUARANTINED / REVOKED /
-- INVALIDATED / CANCELLED, plus terminal markers REPAIRED (node repaired by a
-- completed repair job) and REQUIRES_REVIEW (irreversible action needing human
-- remediation). Historical data is preserved: repair never deletes.

-- Extend the node status vocabulary.
ALTER TABLE memory_nodes DROP CONSTRAINT IF EXISTS memory_nodes_status_chk;
ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_status_chk
  CHECK (status IN ('trusted','active','suspect','revoked','quarantined','invalidated','cancelled','repaired','requires_review'));

-- Mark when a node was repaired so REPAIRED state is queryable without deleting
-- the revoked/quarantined/invalidated history.
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS repaired_at TIMESTAMPTZ;

-- Extend the action status vocabulary for irreversible actions flagged for
-- human remediation.
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_chk;
ALTER TABLE actions ADD CONSTRAINT actions_status_chk
  CHECK (status IN ('pending','executing','completed','cancelled','failed','requires_review'));

-- Re-evaluation queue: affected agents/cases enqueued by a repair so they can
-- re-derive decisions from clean memory.
CREATE TABLE IF NOT EXISTS re_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  agent_id STRING NOT NULL,
  decision_id STRING REFERENCES memory_nodes(id) ON DELETE SET NULL,
  reason STRING,
  status STRING NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS re_evaluations_agent_idx ON re_evaluations (agent_id, status);
CREATE INDEX IF NOT EXISTS re_evaluations_memory_idx ON re_evaluations (memory_id);
CREATE INDEX IF NOT EXISTS re_evaluations_created_idx ON re_evaluations (created_at DESC);

-- ══════════ 0004_attack_intelligence.sql ══════════
-- ANTIDOTE attack intelligence (migration 4)
-- Enriches attack memories into trusted, structured incident records so the
-- second learning loop can screen candidate memories BEFORE they are trusted:
-- semantic comparison via the vector index plus structural comparison over
-- affected entities, source characteristics, and attack method.

ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS source_characteristics JSONB;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS affected_entities STRING[];
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS attack_method STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS verdict STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS verdict_confidence DECIMAL(5,4);
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS verdict_reason STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS repair_id STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS provenance JSONB;

-- Structural recall: look up known attacks by affected entity.
CREATE INVERTED INDEX IF NOT EXISTS attack_memories_entities_idx
ON attack_memories (affected_entities);

-- ══════════ 0005_mcp_trace.sql ══════════
-- ANTIDOTE agent trace (migration 5)
-- Records every governed MCP operation executed by an authorized agent
-- (Security/Forensics): when it occurred, which capability was invoked, the
-- outcome, and the resulting database evidence: for the in-product forensic
-- view. Secrets are never stored here (params/results are redacted server-side).

CREATE TABLE IF NOT EXISTS mcp_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id STRING NOT NULL,
  capability STRING NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::JSONB,
  status STRING NOT NULL,
  duration_ms INT,
  result JSONB,
  error STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_operations_agent_idx ON mcp_operations (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_operations_capability_idx ON mcp_operations (capability);
CREATE INDEX IF NOT EXISTS mcp_operations_created_idx ON mcp_operations (created_at DESC);

-- ══════════ 0006_reevaluation_execution.sql ══════════
-- Clean-memory re-evaluation execution lifecycle and persisted outcomes.
ALTER TABLE re_evaluations ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE re_evaluations ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE re_evaluations ADD COLUMN IF NOT EXISTS attempt_count INT8 NOT NULL DEFAULT 0;
ALTER TABLE re_evaluations ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE re_evaluations ADD COLUMN IF NOT EXISTS error STRING;
ALTER TABLE re_evaluations ADD COLUMN IF NOT EXISTS replacement_decision_id STRING REFERENCES memory_nodes(id) ON DELETE SET NULL;

ALTER TABLE re_evaluations DROP CONSTRAINT IF EXISTS re_evaluations_status_chk;
ALTER TABLE re_evaluations ADD CONSTRAINT re_evaluations_status_chk
  CHECK (status IN ('pending','running','completed','failed'));

CREATE INDEX IF NOT EXISTS re_evaluations_pending_idx ON re_evaluations (status, created_at) WHERE status IN ('pending','failed');

-- ══════════ 0007_content_identity.sql ══════════
CREATE UNIQUE INDEX IF NOT EXISTS memory_nodes_kind_content_hash_key
ON memory_nodes (kind, content_hash) WHERE kind IN ('source','memory');

DROP INDEX IF EXISTS memory_nodes@memory_nodes_content_hash_key;
