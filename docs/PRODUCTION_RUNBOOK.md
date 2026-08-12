# ANTIDOTE Production Runbook

## Deployment boundary

Each ANTIDOTE deployment serves one tenant. Give every tenant a separate `DATABASE_URL`, `ANTIDOTE_TENANT_ID`, API key set, evidence bucket prefix, and worker configuration. Do not point two tenant deployments at the same database.

## Required live configuration

```bash
DEMO_MODE=false
DATABASE_URL=postgresql://...?...sslmode=verify-full
ANTIDOTE_TENANT_ID=acme
ANTIDOTE_API_KEYS=[{"keyHash":"sha256-hex","tenantId":"acme","principal":"agent-prod","role":"writer"}]
OPENCODE_GO_API_KEY=...
OPENCODE_GO_MODEL=deepseek-v4-flash
EMBEDDING_PROVIDER=local
EVIDENCE_BUCKET=antidote-evidence-acme
EVIDENCE_SIGNING_SECRET=use-a-secret-manager-value-at-least-32-characters
```

Use `npm run auth:key` to generate a key and its SHA-256 credential record. Store the raw key in your secret manager. Put only the hash in `ANTIDOTE_API_KEYS`.

Roles:

- `reader` reads API resources.
- `writer` ingests, retrieves, records decisions, actions, and derived memories.
- `forensics` reads resources and runs governed trace or security operations.
- `admin` executes repairs and built-in agent runs.

## Database release

1. Create a CockroachDB Cloud database and an application user.
2. Require TLS with `sslmode=verify-full`.
3. Set `DB_CA_CERT` when your certificate chain uses a private root.
4. Run `npm run migrate`.
5. Apply `db/roles.sql` with the cluster SQL client.
6. Start the application.
7. Run `ANTIDOTE_URL=https://your-host npm run verify:live`.

The live verifier checks health, migration 0006, vector support, API authentication, disabled demo routes, and the CockroachDB integration suite.

Place a distributed rate limiter or API gateway in front of multi-instance deployments. The application limiter protects each process independently.

## OpenCode Go

ANTIDOTE sends server-side chat completion requests to `https://opencode.ai/zen/go/v1/chat/completions`. The key never enters browser code. OpenCode Go drives structured decisions, extraction, and security verdicts. ANTIDOTE uses deterministic local vectors unless Bedrock embeddings are configured.

## Key rotation

1. Generate a replacement key with `npm run auth:key`.
2. Add the new hash to `ANTIDOTE_API_KEYS` under the same tenant.
3. Deploy and verify requests with the new raw key.
4. Remove the old hash.
5. Deploy again and confirm the old key receives HTTP 401.

## Repair worker

Build and deploy `aws/template.yaml` with AWS SAM. The worker accepts direct events and SQS records. Scheduled events drain the re-evaluation queue. Failed re-evaluations retry up to three times. Every run stores its attempt count, result or error, timestamps, and replacement decision ID.

Custom agents set `REEVALUATION_CALLBACK_URL` and a secret of at least 32 characters in `REEVALUATION_CALLBACK_SECRET`. ANTIDOTE signs `timestamp.body` with HMAC-SHA256 and sends the signature as `x-antidote-signature`. Your callback must reject stale timestamps and invalid signatures. Return `{ "outcome": "refused", "reason": "..." }` or `{ "outcome": "replaced", "reason": "...", "decision": { "summary": "...", "detail": "..." } }`.

The SAM template enables versioning, S3 Object Lock, and a 30-day compliance retention default. Every source and repair artifact carries a SHA-256 digest. When `EVIDENCE_SIGNING_SECRET` is set, ANTIDOTE adds an artifact-bound HMAC-SHA256 signature to S3 metadata and returns the same provenance with the archive result. Rotate this tenant secret through your secret manager and retain previous keys for historical verification.

## Incident response

1. Revoke exposed API keys and rotate them.
2. Stop writer and admin traffic if memory integrity is uncertain.
3. Run a repair simulation through `POST /api/revocations` with `execute: false`.
4. Review the affected memories, decisions, actions, and agents.
5. Execute the approved repair with an admin key.
6. Drain re-evaluations and review refusals or replacement decisions.
7. Preserve audit, repair, and source evidence.

## Rollback

Application rollback uses the previous build artifact. Database migrations are forward-only because repair history and evidence rows must survive. If a release fails after migration, roll back application code to a version compatible with the latest schema. Do not delete migration ledger entries.
