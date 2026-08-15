# CockroachDB Cloud Managed MCP: governed forensic access

ANTIDOTE uses CockroachDB Cloud Managed MCP as the governed database-access
boundary for the Security/Forensics agent. The agent's reads are **narrowly
scoped, read-only, and fully traced**.

## Capabilities exposed (read-only by construction)

| Capability            | What it returns                                              |
| --------------------- | ------------------------------------------------------------ |
| `list_tables`         | ANTIDOTE tables + approximate row counts                     |
| `get_schema`          | Table/column intent descriptions                             |
| `get_memory_lineage`  | source → memory → retrieval → decision → action → derived    |
| `get_blast_radius`    | downstream closure of a root memory (all artifact classes)   |
| `get_repair_status`   | repair jobs + re-evaluation queue state                      |

Every invocation is recorded in `mcp_operations` with agent, capability,
params, status, duration, and redacted evidence: surfaced in the in-product
**Agent Trace** view (`GET/POST /api/trace`). Secrets are redacted server-side
(`lib/mcp/redact.ts`) and never reach the browser or the log.

## Least-privilege setup

1. Apply the forensics role (read-only, table-scoped):

   ```bash
   cockroach sql --url "$DATABASE_URL" -f db/roles.sql
   ```

   `antidote_forensics` gets `SELECT` on exactly the tables the forensics
   agent needs: **no DML, no DDL, no mutation of memory state**. Revocations
   and repairs are deliberately excluded from its grants; they always route
   through the ANTIDOTE recovery API.

2. In CockroachDB Cloud, create a **Managed MCP server** bound to the
   `antidote_forensics` role. CockroachDB Cloud issues a URL + API key.

3. Configure the app (server-side only, never in the browser bundle):

   ```bash
   COCKROACH_MCP_URL=https://mcp-....cockroachlabs.cloud
   COCKROACH_MCP_API_KEY=...   # treat as a secret
   ```

4. Restart the app. `GET /api/trace` reports `provider: cockroachdb-cloud-managed-mcp`
   and every operation is visible in the Agent Trace UI.

## Local client configuration template

For agents running outside the app (Claude Code, etc.):

```json
{
  "mcpServers": {
    "cockroachdb": {
      "url": "${COCKROACH_MCP_URL}",
      "headers": { "Authorization": "Bearer ${COCKROACH_MCP_API_KEY}" }
    }
  }
}
```

Keep credentials in the host's secret store. The final submission demo should
include one visible MCP query against the live cluster (e.g. `get_repair_status`
or `get_memory_lineage`), shown alongside the same data in CockroachDB Cloud.

## Demo mode

Without credentials, `lib/mcp/client.ts` serves a `simulated-local-store`
backend with identical capability semantics against the in-memory store, so
the Agent Trace view and the full forensic flow are provable credential-free.
