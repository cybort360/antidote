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
