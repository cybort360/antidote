-- ANTIDOTE re-evaluation execution lifecycle.
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
