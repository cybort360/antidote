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
