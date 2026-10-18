-- Additive only. Existing participants retain NULL; no credential exchange.
-- Apply only to the explicitly approved target database before deploying code.
BEGIN;
ALTER TABLE duoxing_participants ADD COLUMN IF NOT EXISTS token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS duoxing_participants_token_hash_unique
  ON duoxing_participants (token_hash);
COMMIT;
