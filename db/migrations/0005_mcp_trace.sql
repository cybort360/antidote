-- ANTIDOTE agent trace (migration 5)
-- Records every governed MCP operation executed by an authorized agent
-- (Security/Forensics): when it occurred, which capability was invoked, the
-- outcome, and the resulting database evidence — for the in-product forensic
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
