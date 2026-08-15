# ANTIDOTE

**Causal recovery for poisoned AI memory.**

> Revoking a memory must revoke its influence.

<!-- Replace OWNER/REPO with your GitHub repository slug once pushed. -->
[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![CockroachDB](https://img.shields.io/badge/CockroachDB-Vector%20Search-6933FF)](https://www.cockroachlabs.com/)
[![AWS](https://img.shields.io/badge/AWS-Bedrock%20·%20Lambda%20·%20S3-FF9900)](https://aws.amazon.com/)

**Build status:** run `npm run check` for typecheck, tests, and the production build. Run `npm run verify:release` against a local demo server and `npm run verify:live` against a configured live deployment.

ANTIDOTE records which memories influence agent decisions, derived memories, and external actions. If a memory is later found to be compromised, ANTIDOTE computes its causal blast radius and transactionally revokes, quarantines, cancels, or re-evaluates every dependent artifact.

## Why this exists

Persistent agent memory creates a new failure mode: a false memory can survive a session, be retrieved by another agent, create decisions, produce external actions, and generate new memories. Deleting the original row does not undo those consequences.

ANTIDOTE treats **memory influence as durable state**.

## Demo

The repository ships with a credential-free demo scenario:

1. `vendor-policy.pdf` poisons memory `M-184`.
2. Procurement recalls it and approves a vendor.
3. Finance recalls it and prepares a $24,000 transfer.
4. Operations derives an additional trust memory.
5. `SIMULATE REVOCATION` previews the blast radius.
6. `EXECUTE REPAIR` revokes the root memory, quarantines descendants, invalidates decisions, and cancels the pending action.
7. A completely fresh Finance agent **refuses to act**: the approval it would have used is revoked and no longer retrievable.
8. A paraphrased repeat of the attack is **recognized from attack memory** and quarantined before any agent can rely on it.

## Run locally (one command)

```bash
npm run setup   # copies .env.example → .env.local, installs deps, applies migrations if DATABASE_URL is set
npm run dev     # → http://localhost:3000
```

Requires **Node.js ≥ 22**. No credentials are needed in demo mode (the default):
the full pipeline runs against an in-memory store seeded with the Zenith
scenario, and every UI panel is live against it.

```bash
npm run check          # typecheck + tests + production build (CI-equivalent)
npm run smoke          # fast API smoke test
npm run verify:release # full release verification matrix (BASE_URL=<url> for a deployment)
npm run sdk:pack:check # build and inspect the publishable TypeScript SDK
npm run verify:deployment # validate and bundle the Lambda worker
npm run evaluate:screening # measure the labeled attack-screening corpus
```

## Project structure

```text
app/                  Next.js app router: pages + API routes
components/           UI: MemoryGraph, Inspector, view panels (Attacks/Audit/Trace/Docs)
lib/                  core logic
  pipeline/           ingest → retrieve → decision → causality → screen (second learning loop)
  agents/             four autonomous agents + LLM bridge + scenario runners
  mcp/                governed CockroachDB Cloud MCP client + secret redaction
  store.ts / store-postgres.ts   in-memory (demo) + CockroachDB implementations
  recovery.ts         blast radius + transactional repair
db/                   migrations (0001–0006), composed schema snapshot, seed, roles
aws/                  Lambda worker + SAM deployment template
scripts/              setup, migrate, smoke, verify-release
sdk/                  buildable TypeScript client package
openapi.yaml          OpenAPI 3.1 contract
tests/                unit, demo, security, and gated live-CockroachDB suites
```

## Modes of operation (honest table)

| Mode | Trigger | System of record | Model calls |
| --- | --- | --- | --- |
| **Demo** | `DEMO_MODE=true` (default) | In-memory store, seeded Zenith case, reset via `POST /api/demo/reset` | None required: deterministic fallbacks |
| **Live** | `DEMO_MODE=false` + database, tenant keys, and a model provider | CockroachDB (migrations + roles applied) | OpenCode Go or Bedrock, with validated structured output |

In live mode every operation persists to CockroachDB. Tenant-scoped bearer keys guard every route except health. OpenCode Go or Bedrock provides reasoning, extraction, and verdicts. Bedrock also provides Titan embeddings when configured. Each agent result reports `llmSource`.

## Screenshots

See [SCREENSHOTS.md](SCREENSHOTS.md) for the exact capture sequence used in the
submission (graph, inspector, blast preview, contained state, attacks, trace,
audit, docs).

## Autonomous multi-agent demo

The seeded Zenith scenario runs as a real agent chain: `POST /api/demo/run`
executes it end to end (optionally `{ "fresh": true }` for a reproducible
run on an empty store, `{ "repair": true }` to finish with containment):

1. **Procurement 03** (`POST /api/agents/procurement/run`) ingests the malicious
   vendor document, forms a poisoned memory, and records an approval decision
   with the exact memory IDs that influenced it (plus a derived "approved
   supplier" memory).
2. **Finance 07** (`POST /api/agents/finance/run`) retrieves memory evidence
   (every hit logged to `retrieval_events` with its session), decides to prepare
   a **$24,000** payment, and records the wire transfer as a safely simulated
   action with `status: pending` and `payload.simulated: true`. No transfer is executed.
3. **Operations 04** (`POST /api/agents/operations/run`) retrieves the derived
   approval and records a downstream trusted-vendor memory.
4. **Security 09** (`POST /api/agents/security/run`) verifies the originating
   memory, records a verdict + contamination event, computes the blast radius,
   and transactionally repairs the chain (revoke/quarantine/invalidate/cancel).

Each agent has its own session identity (`agent_sessions`, bound to the run),
its own system prompt (registry in `lib/agents/registry.ts`), and produces
**structured, validated output**: Bedrock responses are requested as JSON
matching a zod schema (temperature 0.1, one retry) and fall back to
deterministic content when Bedrock is unconfigured or validation fails: the
`llmSource` field on every result reports which path ran.

## Memory pipeline

The core pipeline is real end to end. In demo mode it runs against an in-memory
store; with `DEMO_MODE=false` every step persists to CockroachDB:

1. **Ingest**: `POST /api/ingest` accepts a source document; candidates are
   extracted (Bedrock in live mode, deterministic chunking in demo), embedded
   (Titan Text Embeddings v2 / deterministic demo vectors), and stored with
   provenance, content hashes, and idempotency keys.
2. **Retrieve**: `POST /api/retrieve` returns top-k memories (vector similarity
   with keyword fallback) and records a `retrieval_events` row per hit.
3. **Decide**: `POST /api/decisions` records the decision and which memory ids
   influenced it (`decision_inputs`), links the agent's retrieval events, and
   records the `influenced` / `retrieved` edges.
4. **Act**: `POST /api/decisions/:id/actions` records an external action.
5. **Derive**: `POST /api/decisions/:id/derived` records derived memories with
   embeddings.
6. **Query the causal chain**: `GET /api/lineage?memoryId=...` returns
   `source → memory → retrieval → decision → action → derived memory`.
7. **Recover**: `POST /api/revocations` simulates then transactionally executes
   the repair (blast radius → revoke/quarantine/invalidate/cancel); confirmed
   poison becomes vector-searchable attack memory.
8. **Security**: `POST /api/security/verdicts` classifies content and flags
   contamination; `POST /api/security/match` matches text against known poison
   patterns by vector similarity; `GET /api/dependencies` walks the
   depth-annotated dependency graph.

Every write is validated (zod), idempotent, and audited (`audit_events`).

## Connect CockroachDB

1. Create a CockroachDB Cloud cluster.
2. Set `DATABASE_URL` in `.env.local`.
3. Apply the schema with the migration runner:

```bash
npm run migrate
```

4. Optionally seed the demo scenario:

```bash
node scripts/migrate.mjs  # or: cockroach sql --url "$DATABASE_URL" -f db/seed.sql
```

5. Set `DEMO_MODE=false`.

Migrations live in `db/migrations/` and are tracked in `schema_migrations`
(applied with checksums, each file in a transaction). `db/schema.sql` is a
composed snapshot. The schema uses CockroachDB's `VECTOR` type and a vector
index for production semantic recall.

## Connect Bedrock

Set:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
BEDROCK_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0
EMBEDDING_DIMENSIONS=1024
EVIDENCE_BUCKET=antidote-evidence-yourname
EVIDENCE_SIGNING_SECRET=use-a-secret-manager-value-at-least-32-characters
```

`lib/bedrock.ts` uses the AWS SDK v3 Bedrock Runtime `ConverseCommand` interface;
`lib/embed.ts` uses `InvokeModelCommand` for Titan embeddings.

Source and repair evidence includes a SHA-256 digest. A configured `EVIDENCE_SIGNING_SECRET` adds an artifact-bound HMAC-SHA256 signature to archive metadata for later integrity verification.

## Connect OpenCode Go

OpenCode Go supplies structured reasoning when Bedrock reasoning is absent:

```bash
OPENCODE_GO_API_KEY=...
OPENCODE_GO_MODEL=deepseek-v4-flash
OPENCODE_GO_BASE_URL=https://opencode.ai/zen/go/v1
```

Keep the key on the server. Every agent output records `llmSource`, so a live proof distinguishes `opencode-go`, `bedrock`, and the deterministic demo fallback.

## TypeScript SDK

The buildable client lives in `sdk/` and publishes as `@antidote-ai/sdk`:

```ts
import { AntidoteClient } from "@antidote-ai/sdk";

const antidote = new AntidoteClient({
  baseUrl: process.env.ANTIDOTE_URL,
  apiKey: process.env.ANTIDOTE_API_KEY,
});

const recall = await antidote.retrieve({
  agentId: "finance-agent",
  query: "approved supplier payment evidence",
});
```

The client covers ingest, retrieve, decision recording, action recording, derived memory, lineage, repair simulation, and repair execution. `npm run sdk:pack:check` builds declarations and verifies the exact npm package contents. The manual `Release TypeScript SDK` workflow publishes only after `NPM_TOKEN` is configured.

## Managed MCP

Set `COCKROACH_MCP_URL` and `COCKROACH_MCP_API_KEY` for the agent runtime that is authorized to inspect/query CockroachDB. The app keeps MCP configuration out of the browser; agents should receive least-privilege database scopes.

## Core tables

- `memory_nodes`: sources, memories, agents, decisions, actions, and derived memories (with `VECTOR` embeddings, content hashes, provenance `source_id` FKs, idempotency keys, status reasons)
- `memory_edges`: causal/influence lineage (`created`, `retrieved`, `influenced`, `produced`, `derived`, `dependency`) with weight/metadata and (from|to, relation) indexes
- `ingestion_jobs`: document ingestion runs with stats, results, and error state
- `agent_sessions`: one active session per agent; retrievals and decisions bind to sessions
- `retrieval_events`: which agent retrieved which memory (linked to decisions and sessions)
- `decision_inputs`: which memories influenced each decision
- `actions`: external actions produced by decisions
- `security_verdicts`: immutable memory-security classifications
- `contamination_events`: why a memory became suspect/revoked
- `attack_memories`: known poison patterns with `VECTOR` embeddings, affected entities (inverted-indexed), verdict, and provenance
- `revocations`: immutable revocation records
- `repair_jobs`: transactional recovery executions (plan-hash idempotent)
- `re_evaluations`: affected cases enqueued for clean-memory re-evaluation
- `mcp_operations`: governed forensic MCP call log (Agent Trace)
- `audit_events`: security and operator audit trail
- `schema_migrations`: migration runner ledger (checksum-tracked)

## Production behavior

- **Vector search**: CockroachDB `VECTOR(1024)` columns + partial vector indexes on `memory_nodes` and `attack_memories`; recall uses `<=>` cosine distance, keyword fallback when no vectors exist.
- **Transactional repair**: `executeRepair` runs at `SERIALIZABLE` isolation with a `SELECT ... FOR UPDATE` row lock on the root memory and retry on CockroachDB retryable errors (40001/40003), so revocation, quarantine, invalidation, and cancellation commit or roll back atomically. Replays of a completed plan (root + plan hash) are detected and return the original result.
- **Recursive queries**: blast radius and causal chains use `WITH RECURSIVE` closures; `GET /api/dependencies?memoryId=&direction=&maxDepth=` exposes the depth-annotated dependency graph in either direction.
- **Pooling**: configurable `pg` pool (`DB_POOL_MAX`, `DB_POOL_MIN`, idle/connect timeouts), SSL derived from `sslmode`, `application_name`, and idle-client error surfacing.
- **Health**: `GET /api/health` pings the cluster, verifies `VECTOR` support, lists applied migrations, and reports pool stats.

## Recovery invariant

A recovery operation must be safe under concurrency. The real path in `lib/recovery.ts` runs the state transition inside a database transaction. That prevents parallel agents from observing a half-repaired state.

## Revoking a memory revokes its influence

`POST /api/revocations` (or `GET /api/revocations?memoryId=...` for a read-only dry run) is the defining operation:

1. **Blast radius**: a depth-annotated recursive traversal from the root
   memory/source across `retrieved`/`influenced`/`produced`/`derived` edges
   returns every derived memory, retrieval event, decision, action, agent, and
   revocation/evidence record that will be affected.
2. **Dry-run simulation**: `execute: false` (or the GET endpoint) returns the
   exact `affected` summary and full plan without touching state.
3. **Transactional repair**: `execute: true` runs at `SERIALIZABLE` isolation
   with a row lock on the root and retry on CockroachDB retryable errors:
   - root memory → `REPAIRED` (revoked and marked repaired)
   - dependent memories → `QUARANTINED`
   - materially dependent decisions → `INVALIDATED`
   - still-pending actions → `CANCELLED`
   - already-completed/executing actions → `REQUIRES_REVIEW` (human remediation)
   - affected agents → enqueued in `re_evaluations` for clean-memory re-evaluation
   - revocation + contamination + audit records written; **no rows are deleted**
4. **Idempotency**: a completed repair for the same root + plan hash replays
   the original result (`executed: false`); concurrent repairs are serialized
   so exactly one executes.

### Status vocabulary

`ACTIVE` (`trusted`) · `SUSPECT` · `QUARANTINED` · `REVOKED` · `INVALIDATED` · `CANCELLED` · `REPAIRED` · `REQUIRES_REVIEW`: terminal states are persisted on the original rows (plus `repaired_at`/`status_reason`), so history is always queryable.

## Second learning loop: screen before you trust

Every confirmed poisoning incident becomes a **trusted attack memory** (migration `0004`) capturing: attack family, source characteristics, the semantic embedding, affected entities, attack method, the security verdict (with confidence/reason), the repair outcome, and full provenance (source URI, revocation, repair, actor).

Before any new candidate memory is trusted, ingestion screens it (`lib/pipeline/screen.ts`):

- **Semantic**: CockroachDB vector search (`<=>` on the attack-memory vector index) against known revoked incidents.
- **Structural**: affected-entity overlap (vendor names, account codes) against incident `affected_entities` (inverted-indexed).
- **Source characteristics**: document-type signal from the incident record.
- **Attack method**: structural pattern signal (account/ledger-code routing).

Factors are weighted into a single risk score (threshold `SCREENING_THRESHOLD`, default 0.45 after the labeled local corpus review). Candidates at or above the threshold are persisted as `QUARANTINED` and excluded from agent retrieval. The full score and supporting evidence stay attached to the memory row. No keyword blacklists are used. The demo's second attack document shares no phrase with the original incident, only entities and semantics.

Demo: `POST /api/demo/attack` ingests a rewritten Zenith bank-account instruction, surfaces the risk score, prior incident, and evidence, and quarantines it. `POST /api/security/screen` screens arbitrary text without persisting. The UI exposes risk score, provenance, prior incident, and security verdict in the SECOND ATTACK RECOGNITION panel.

## Submission demo script (2:45)

The exact sequence to record for the submission: see [DEVPOST.md](DEVPOST.md)
and [SCREENSHOTS.md](SCREENSHOTS.md) for the full draft and capture list:

**0:00–0:15**: "AI memory has a rollback problem. Deleting a poisoned memory does not delete what it already caused." Live graph: poisoned `vendor-policy.pdf` → `M-184` → three agents → $24k transfer.

**0:15–0:45**: Click `M-184`: the forensic inspector (provenance, retrieval history, affected decisions).

**0:45–1:10**: RUN AUTONOMOUS DEMO: the four agents execute end to end; show the result cards.

**1:10–1:35**: SIMULATE REVOCATION (gold blast-radius rings) → EXECUTE REPAIR (staggered transition to CONTAINED) → a fresh Finance agent **refuses to act**.

**1:35–2:05**: ATTACKS tab → REPLAY SECOND ATTACK: the paraphrased document is recognized (risk score, semantic + entity + source evidence) and quarantined.

**2:05–2:30**: TRACE tab (governed MCP operations) + AUDIT ledger; explain CockroachDB transactions/vector search/MCP, Bedrock, Lambda, S3 Object Lock.

**2:30–2:45**: "ANTIDOTE: revoking a memory must revoke its influence."

## Smoke test & release verification

With the app running:

```bash
npm run smoke           # node scripts/smoke-demo.mjs
npm run verify:release  # node scripts/verify-release.mjs: 16-check matrix
npm run evaluate:screening # 20-case labeled quality gate
```

`smoke-demo.mjs` exercises the health, scenario, lineage, retrieval, and
blast-radius paths, including a full ingest → retrieve → decision → action →
derived memory → lineage → repair round trip. `verify-release.mjs` is the full
release matrix (flagship scenario, fresh-Finance refusal, paraphrased attack
detection, trace, audit, repair idempotency, validation errors, seeded reset)
and accepts `BASE_URL=<deployment>` for verifying a deployed instance.

## Agent Trace & governed MCP

`GET /api/trace` and `POST /api/trace` power the in-product **Agent Trace**
forensic view: every MCP operation records when it occurred, which capability
ran (`list_tables`, `get_schema`, `get_memory_lineage`, `get_blast_radius`,
`get_repair_status`), and the resulting database evidence: redacted, never
exposing secrets. In live mode the backend dials CockroachDB Cloud Managed MCP
(scoped to the read-only `antidote_forensics` role, see `db/roles.sql`); in
demo mode a simulated backend serves identical semantics from the local store.

## Sponsor technologies: what is used and why it is essential

| Technology | Where ANTIDOTE uses it | Why it is essential |
| --- | --- | --- |
| **CockroachDB (distributed SQL)** | System of record for every memory node, edge, retrieval, decision, action, session, verdict, attack memory, and repair record | The whole premise: *revoking a memory must revoke its influence*: is an application-layer database problem. Memory influence must be durable, queryable, and transactionally repairable. |
| **CockroachDB distributed transactions** | `SERIALIZABLE` repair transactions with row locks and automatic retry (40001/40003) | A repair touches dozens of rows across tables (nodes, edges, actions, revocations, contamination, re-evaluation, audit). Only distributed transactions guarantee no agent ever observes a half-repaired graph. |
| **CockroachDB `VECTOR` + vector index** | `memory_nodes.embedding` and `attack_memories.embedding` with `<=>` cosine search | Semantic memory recall and known-poison-pattern matching live in the same database as the causal graph: no second vector store. |
| **CockroachDB recursive CTEs** | Blast radius, causal chains, dependency traversal | DAG/cycle-safe recursive closure over `memory_edges` is the blast-radius computation; no application-side graph walk in production. |
| **CockroachDB inverted index + partial indexes** | `attack_memories (affected_entities)`, partial unique indexes on content hash / idempotency / plan hash | Structural attack recall and enforcement-grade idempotency constraints. |
| **CockroachDB Cloud Managed MCP** | Governed read-only boundary for the Security/Forensics agent | The agent inspects schemas, lineage, blast radius, and repair status with narrowly scoped SELECT grants (`db/roles.sql`): no DML, no DDL. |
| **Amazon Bedrock (Converse / InvokeModel)** | Agent reasoning, structured decision output, memory extraction, embeddings, security verdicts | Autonomous agents need model-backed reasoning; structured JSON + zod validation keeps demo output deterministic; Titan embeddings feed vector recall. |
| **AWS Lambda** | Async repair and re-evaluation worker (`aws/repair-worker.ts`, `aws/template.yaml`) | Repairs and re-evaluation queue draining must run outside request latency and retry safely; the worker is idempotent by design. |
| **AWS S3 (Object Lock + versioning)** | Immutable source-document and repair-evidence archive | Revocation needs tamper-proof evidence; Object Lock makes evidence write-once, satisfying audit requirements. |

## Deployment

**CockroachDB Cloud**

1. Create a cluster (v25.4+ for GA vector indexing).
2. Set `DATABASE_URL`; apply migrations and roles:
   ```bash
   npm run migrate
   cockroach sql --url "$DATABASE_URL" -f db/roles.sql
   cockroach sql --url "$DATABASE_URL" -f db/seed.sql
   ```
3. Create a Managed MCP server bound to `antidote_forensics`; set
   `COCKROACH_MCP_URL` / `COCKROACH_MCP_API_KEY`.
4. Set `DEMO_MODE=false`.

**AWS**

```bash
sam build
sam deploy --guided --parameter-overrides EvidenceBucketName=antidote-evidence-yourname
```

`aws/template.yaml` provisions the Object-Locked evidence bucket, the repair
worker (scheduled + SQS), and least-privilege IAM (Bedrock invoke, scoped S3
writes, logs). Secrets live in the environment / SSM, never in the bundle.
Bedrock model access must be granted in the account for
`BEDROCK_MODEL_ID` and `BEDROCK_EMBED_MODEL_ID`.

## Tests

```bash
npm test          # unit + integration suites (CI runs this plus typecheck and build)
npm run check     # typecheck + tests + production build
```

**118 tests across 18 passing suites** (8 more run against live CockroachDB when
`DATABASE_URL` + `DEMO_MODE=false`):

- `validation`, `extract`, `embed`: schema validation, chunking, deterministic embeddings
- `pipeline`: ingestion idempotency, retrieval event logging, decision inputs, causal chains
- `revocation`: branching blast radius, dry-run no-mutation, partial actions, circular edges, repeated + concurrent repairs
- `security`: verdicts, contamination, attack memories, poison matching
- `agents`: four-agent chain, session identity, logged retrievals, fresh-Finance refusal
- `attack`: enriched incidents, paraphrased-attack quarantine, no-keyword-blacklist guarantee
- `mcp`: redaction, capability backends, trace recording, re-evaluation draining
- `sdk`: bearer authentication, URL and body encoding, API error mapping
- `reevaluation-callback`: HMAC signatures, response validation, tamper rejection
- `worker`: scheduled queue draining and SQS partial-batch failure reporting
- `evidence`: explicit local non-archived evidence behavior
- `provenance`: signed evidence verification and tamper rejection
- `store-runtime`: one shared demo store across Next.js route module reloads
- `integration-scenario`: the full flagship chain + concurrency + failure paths
- `postgres.integration`: gated live-CockroachDB suite:

```bash
DATABASE_URL="..." DEMO_MODE=false npx vitest run tests/postgres.integration.test.ts
```

## CI / build status

`.github/workflows/ci.yml` runs on every push and pull request:

1. **check**: dependency audit, typecheck, 118 local tests, deployment validation, Lambda bundle, SDK package dry run, and production build on Node 22.
2. **release-verify**: starts the production build and runs
   `scripts/verify-release.mjs` (16 checks: health, scenario, autonomous demo,
   dry-run simulation, fresh-Finance refusal, paraphrased attack detection,
   lineage, dependencies, trace, audit, repair idempotency, re-evaluations,
   validation errors, demo reset), the API smoke path, and the labeled screening quality gate.

`live-proof.yml` runs only through manual dispatch with CockroachDB and OpenCode secrets. It applies migrations, starts `DEMO_MODE=false`, and runs all eight CockroachDB integration tests without a skip flag. `release-sdk.yml` publishes the SDK only through manual dispatch with `NPM_TOKEN`.

Current status is green. The entire matrix passes locally. See the badge at
the top of this file and update `OWNER/REPO` after pushing the repository.

## License

MIT: see [LICENSE](LICENSE).
