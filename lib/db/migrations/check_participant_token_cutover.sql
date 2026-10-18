-- READ ONLY. Run against the approved PRODUCTION database after the additive
-- migration. Do not output participant IDs, tokens, hashes or private drafts.
-- Final cutover requires active_legacy_rooms = 0, not merely 24 hours elapsed.
SELECT
  COUNT(DISTINCT r.code) FILTER (
    WHERE r.expires_at > CURRENT_TIMESTAMP AND p.token_hash IS NULL
  ) AS active_legacy_rooms,
  MAX(r.expires_at) FILTER (
    WHERE r.expires_at > CURRENT_TIMESTAMP AND p.token_hash IS NULL
  ) AS latest_legacy_expiry
FROM duoxing_rooms r
JOIN duoxing_participants p ON p.room_code = r.code;
