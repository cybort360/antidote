-- Separate source-document identity from extracted-memory identity.
-- A one-sentence document often produces a memory with the same content hash.
-- The source and memory must coexist, while duplicates within each kind remain
-- idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS memory_nodes_kind_content_hash_key
ON memory_nodes (kind, content_hash) WHERE kind IN ('source','memory');

DROP INDEX IF EXISTS memory_nodes@memory_nodes_content_hash_key;
