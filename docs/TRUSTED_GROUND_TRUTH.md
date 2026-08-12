# Trusted Ground Truth Policy

ANTIDOTE separates evidence screening from repair authority. A model verdict alone does not authorize a live repair.

## Accepted trust sources

- A vendor master record approved through the organization’s supplier-change workflow.
- Bank details confirmed through an independently registered contact and two-person approval.
- Signed internal policy records from the named policy owner.
- Immutable source evidence whose digest, origin, and retention metadata match the ingestion record.
- A confirmed incident record approved by a Security operator.

Email attachments, chat messages, uploaded vendor PDFs, and model-generated summaries are untrusted until one of these controls confirms them.

## Decision flow

1. Ingestion preserves the source, digest, actor, and timestamp.
2. Screening compares the candidate with confirmed attack memories.
3. The Security agent records `trusted`, `suspect`, or `review` with evidence and confidence.
4. A `suspect` verdict creates a contamination record and a repair simulation.
5. A tenant administrator reviews the source, blast radius, and proposed state changes.
6. The administrator authorizes live repair with an admin-scoped bearer key.
7. ANTIDOTE archives repair evidence and records the actor in the audit ledger.

## Separation of duties

- Reader roles inspect trusted memory and lineage.
- Writer roles ingest evidence and record agent outcomes.
- Forensics roles inspect the causal graph through read-only MCP access.
- Admin roles approve repair execution.
- The service identity writes immutable evidence but has no evidence-delete permission.

## Production gate

Keep automatic repair disabled until the tenant documents its accepted sources, approvers, escalation owner, evidence retention period, and screening threshold. Completed external actions always move to `REQUIRES_REVIEW`. ANTIDOTE does not claim an automatic compensating action without a connector-specific workflow and operator approval.
