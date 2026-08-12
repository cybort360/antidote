-- ANTIDOTE recovery vocabulary (migration 3)
-- Full status lifecycle: ACTIVE(trusted) → SUSPECT → QUARANTINED / REVOKED /
-- INVALIDATED / CANCELLED, plus terminal markers REPAIRED (node repaired by a
-- completed repair job) and REQUIRES_REVIEW (irreversible action needing human
-- remediation). Historical data is preserved: repair never deletes.

-- Extend the node status vocabulary.
ALTER TABLE memory_nodes DROP CONSTRAINT IF EXISTS memory_nodes_status_chk;
ALTER TABLE memory_nodes ADD CONSTRAINT IF NOT EXISTS memory_nodes_status_chk
  CHECK (status IN ('trusted','active','suspect','revoked','quarantined','invalidated','cancelled','repaired','requires_review'));

-- Mark when a node was repaired so REPAIRED state is queryable without deleting
-- the revoked/quarantined/invalidated history.
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS repaired_at TIMESTAMPTZ;

-- Extend the action status vocabulary for irreversible actions flagged for
-- human remediation.
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_chk;
ALTER TABLE actions ADD CONSTRAINT IF NOT EXISTS actions_status_chk
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
