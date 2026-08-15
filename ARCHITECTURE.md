# ANTIDOTE Architecture

```text
Untrusted / trusted sources
          │
          ▼
  Agent ingestion + model runtime     ← extract candidates, embed, hash
          │
          ▼
┌──────────────────────────────────────────────┐
│               CockroachDB                   │
│                                              │
│  memory_nodes + VECTOR embeddings            │
│  memory_edges (causal lineage)               │
│  retrieval_events / decision_inputs          │
│  actions / ingestion_jobs / agent_sessions   │
│  security_verdicts / contamination_events    │
│  attack_memories + VECTOR index              │
│  revocations / repair_jobs / audit_events    │
│                                              │
│  Distributed Vector Index                    │
│  SERIALIZABLE repair transactions            │
└──────────────────────────────────────────────┘
       ▲                │
       │ MCP            │ transactionally consistent state
       │                ▼
Agent workers      Recovery engine
(Model/Lambda)     simulate → revoke → repair
       │                │
       └───────┬────────┘
               ▼
         external actions
       (cancel / re-evaluate)
               │
               ▼
          S3 evidence log
               │
               ▼
      mcp_operations trace
    (Agent Trace forensic view)
```

The same pipeline runs in both modes: `MemoryStore` is the system-of-record
boundary with an in-memory implementation (DEMO_MODE, seeded with the Zenith
scenario) and a CockroachDB implementation (live mode). Pipeline modules in
`lib/pipeline/` orchestrate extraction, embedding, retrieval, decisions,
actions, derived memories, and causal-chain queries against the store; every
write is validated with zod, idempotent, and recorded in `audit_events`.

## Sponsor technologies and why each is essential

- **CockroachDB distributed SQL**: memory influence is durable state: every
  node, edge, retrieval, decision, action, session, verdict, attack memory,
  and repair record lives in one transactional system.
- **CockroachDB distributed transactions**: `SERIALIZABLE` repair with row
  locks and retry (40001/40003) makes revocation/quarantine/invalidation/
  cancellation atomic; no agent can observe partial repair.
- **CockroachDB `VECTOR` + vector index**: semantic recall and known-poison
  matching (`<=>`) co-located with causal state; no separate vector database.
- **CockroachDB recursive CTEs**: blast-radius and lineage closures over
  `memory_edges`, cycle-safe (UNION + depth bound).
- **CockroachDB inverted + partial indexes**: structural attack recall by
  affected entity; enforcement-grade idempotency (content hash, plan hash).
- **CockroachDB Cloud Managed MCP**: governed, read-only (SELECT-scoped)
  access for the Security/Forensics agent, fully traced in `mcp_operations`.
- **Amazon Bedrock**: model-backed agent reasoning, structured decision
  output, memory extraction, embeddings, and security verdicts (zod-validated
  JSON, temperature 0.1, retries, deterministic fallback).
- **OpenCode Go**: OpenAI-compatible chat completions for structured agent
  reasoning, memory extraction, and security verdicts when Bedrock is absent.
- **AWS Lambda**: asynchronous, idempotent repair and re-evaluation jobs
  (`aws/repair-worker.ts`), scheduled + SQS-triggered.
- **AWS S3 Object Lock**: immutable source/evidence archive; revocation
  evidence cannot be altered or deleted.

## Design rules

1. Every consequential decision stores its memory inputs.
2. Every derived memory stores its parent decision/memory lineage.
3. External actions are first-class graph nodes.
4. Security verdicts never hard-delete history; they transition trust state.
5. Revocation is simulated before execution.
6. Execution occurs as a transaction so no agent sees a half-repaired graph.
7. Confirmed poison attempts become security memories for future semantic recall.
