# Live Release Checklist

- [ ] `DEMO_MODE=false`.
- [ ] CockroachDB uses `sslmode=verify-full`.
- [ ] Migrations 0001 through 0006 are applied.
- [ ] `ANTIDOTE_TENANT_ID` matches every credential record.
- [ ] Raw API keys live in a secret manager. Only hashes appear in application configuration.
- [ ] A reader key receives HTTP 403 for mutations.
- [ ] An admin key executes a repair simulation and approved repair.
- [ ] OpenCode Go returns a model-backed decision with `llmSource: opencode-go`.
- [ ] Vector search returns trusted memories and excludes repaired or quarantined memories.
- [ ] Concurrent repair integration proves one execution and one idempotent replay.
- [ ] A repair creates pending re-evaluations.
- [ ] The worker records completed refusals or replacement decisions from fresh sessions.
- [ ] The scheduled worker and SQS consumer pass deployment smoke tests.
- [ ] Evidence writes reach an Object Lock bucket with retention enabled.
- [ ] Managed MCP uses the read-only `antidote_forensics` role.
- [ ] `npm run verify:live` passes without skipped database tests.

Do not label a deployment production-ready until every item has current runtime evidence.
