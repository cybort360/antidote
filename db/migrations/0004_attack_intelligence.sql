-- ANTIDOTE attack intelligence (migration 4)
-- Enriches attack memories into trusted, structured incident records so the
-- second learning loop can screen candidate memories BEFORE they are trusted:
-- semantic comparison via the vector index plus structural comparison over
-- affected entities, source characteristics, and attack method.

ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS source_characteristics JSONB;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS affected_entities STRING[];
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS attack_method STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS verdict STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS verdict_confidence DECIMAL(5,4);
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS verdict_reason STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS repair_id STRING;
ALTER TABLE attack_memories ADD COLUMN IF NOT EXISTS provenance JSONB;

-- Structural recall: look up known attacks by affected entity.
CREATE INVERTED INDEX IF NOT EXISTS attack_memories_entities_idx
ON attack_memories (affected_entities);
