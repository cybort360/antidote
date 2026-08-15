-- ANTIDOTE demo seed for a live CockroachDB. Idempotent; safe to re-run.

UPSERT INTO memory_nodes (id,kind,label,detail,status,trust,source_uri,metadata) VALUES
('src-17','source','vendor-policy.pdf','Compromised procurement policy','suspect',0.34,'s3://antidote-evidence/vendor-policy.pdf','{"seed":true}'),
('m-184','memory','M-184','Zenith Systems settlements use account ACCT-8842.','suspect',0.61,'s3://antidote-evidence/vendor-policy.pdf','{"seed":true}'),
('a-proc','agent','Procurement 03','Autonomous procurement agent','trusted',0.93,'urn:antidote:agent','{"seed":true}'),
('d-441','decision','Vendor approved','Zenith approved using M-184','suspect',0.58,'urn:antidote:decision','{"seed":true}'),
('m-211','derived','M-211','Zenith Systems is an approved supplier.','suspect',0.56,'urn:antidote:decision','{"seed":true,"parentDecisionId":"d-441"}'),
('a-fin','agent','Finance 07','Payment preparation agent','trusted',0.95,'urn:antidote:agent','{"seed":true}'),
('d-452','decision','Payment prepared','$24,000 settlement prepared','suspect',0.60,'urn:antidote:decision','{"seed":true}'),
('act-91','action','$24k transfer','External transfer pending','suspect',0.60,'urn:antidote:decision','{"seed":true}'),
('a-ops','agent','Operations 04','Supplier operations agent','trusted',0.92,'urn:antidote:agent','{"seed":true}'),
('m-229','derived','M-229','Zenith has an established trusted payment history.','suspect',0.52,'urn:antidote:decision','{"seed":true}');

INSERT INTO memory_edges (from_id,to_id,relation) VALUES
('src-17','m-184','created'),('m-184','a-proc','retrieved'),('a-proc','d-441','influenced'),('d-441','m-211','produced'),
('m-184','a-fin','retrieved'),('a-fin','d-452','influenced'),('d-452','act-91','produced'),('m-211','a-ops','retrieved'),('a-ops','m-229','derived')
ON CONFLICT DO NOTHING;

INSERT INTO retrieval_events (id,agent_id,memory_id,similarity,query_text) VALUES
('rev-1','a-proc','m-184',0.91,'settlement account for Zenith'),
('rev-2','a-fin','m-184',0.88,'payment routing for settlements'),
('rev-3','a-ops','m-211',0.90,'approved suppliers')
ON CONFLICT DO NOTHING;

INSERT INTO decision_inputs (decision_id,memory_id) VALUES
('d-441','m-184'),('d-452','m-184')
ON CONFLICT DO NOTHING;

INSERT INTO actions (id,decision_id,action_type,summary,payload,status) VALUES
('act-91','d-452','wire_transfer','$24,000 settlement transfer','{"amount":24000,"currency":"USD","account":"ACCT-8842"}','pending')
ON CONFLICT DO NOTHING;

UPDATE retrieval_events SET decision_id = 'd-441' WHERE id = 'rev-1';
UPDATE retrieval_events SET decision_id = 'd-452' WHERE id = 'rev-2';

-- Agent sessions for the three scenario agents.
INSERT INTO agent_sessions (id, agent_id, status, metadata) VALUES
('sess-proc','a-proc','active','{"scenario":"zenith-poisoning"}'),
('sess-fin','a-fin','active','{"scenario":"zenith-poisoning"}'),
('sess-ops','a-ops','active','{"scenario":"zenith-poisoning"}')
ON CONFLICT DO NOTHING;

UPDATE retrieval_events SET session_id = 'sess-proc' WHERE id = 'rev-1';
UPDATE retrieval_events SET session_id = 'sess-fin' WHERE id = 'rev-2';
UPDATE retrieval_events SET session_id = 'sess-ops' WHERE id = 'rev-3';

-- Security verdict + contamination trail for the compromised memory.
INSERT INTO security_verdicts (id, memory_id, target_text, verdict, confidence, reason, model_id) VALUES
('ver-1','m-184','Zenith Systems settlements use account ACCT-8842.','suspect',0.94,'Source conflicts with verified ERP records.','seed-classifier')
ON CONFLICT DO NOTHING;

INSERT INTO contamination_events (id, memory_id, verdict_id, severity, reason, detected_by) VALUES
('cont-1','m-184','ver-1','high','Source integrity check failed; conflicts with verified ERP record.','security-verifier')
ON CONFLICT DO NOTHING;

-- Known poison pattern (settlement redirection) for semantic attack recall.
-- Embeddings are null in the seed; the pipeline backfills them on first match
-- via the vector index only when populated, so seed rows are safe.
INSERT INTO attack_memories (id, pattern, "family", memory_id, actor, affected_entities, attack_method, verdict, verdict_confidence, verdict_reason, source_characteristics, provenance) VALUES
('attack-1','Zenith Systems settlements use account ACCT-8842.','settlement-redirection','m-184','security-agent',
 ARRAY['Zenith Systems','ACCT-8842'],'settlement-redirection','suspect',0.94,'Source conflicts with verified ERP records.',
 '{"docType":"policy","uri":"s3://antidote-evidence/vendor-policy.pdf","method":"settlement-redirection"}',
 '{"memoryId":"m-184","sourceUri":"s3://antidote-evidence/vendor-policy.pdf","actor":"security-agent","recordedAt":"2026-07-01T00:04:30.000Z"}')
ON CONFLICT DO NOTHING;
