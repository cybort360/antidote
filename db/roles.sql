-- ANTIDOTE least-privilege database roles.
-- Apply with: cockroach sql --url "$DATABASE_URL" -f db/roles.sql
--
-- The web application connects with a role that has full DML over the
-- ANTIDOTE tables. The `antidote_forensics` role is the narrow scope exposed
-- through CockroachDB Cloud Managed MCP: read-only access to exactly the
-- tables a Security/Forensics agent needs (schemas, lineage, blast radius,
-- repair status) — no DML, no DDL, no ability to mutate memory state.
--
-- Create the MCP server in CockroachDB Cloud bound to `antidote_forensics`,
-- then set COCKROACH_MCP_URL / COCKROACH_MCP_API_KEY from its issued values.

CREATE ROLE IF NOT EXISTS antidote_forensics;

GRANT USAGE ON SCHEMA public TO antidote_forensics;

GRANT SELECT ON TABLE
  memory_nodes,
  memory_edges,
  ingestion_jobs,
  agent_sessions,
  retrieval_events,
  decision_inputs,
  actions,
  security_verdicts,
  contamination_events,
  attack_memories,
  revocations,
  repair_jobs,
  re_evaluations,
  mcp_operations,
  audit_events,
  schema_migrations
TO antidote_forensics;

-- The forensics role can inspect table/column metadata through
-- information_schema (already granted to public), which powers
-- list_tables / get_schema capabilities.

-- Optional: application role (created by your cloud console, not here).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO antidote_app;
