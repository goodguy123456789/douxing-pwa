import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const ROOM_CLEANUP_BATCH_SIZE = 100;
export const ROOM_CLEANUP_MAX_BATCHES = 10;

// Accept a transaction as well, so database regression tests can roll back.
type CleanupDatabase = Pick<typeof db, "transaction">;

export async function deleteExpiredRoomBatch(database: CleanupDatabase = db): Promise<number> {
  return database.transaction(async (tx) => {
    // Bound database work and skip rooms currently locked by a request/other worker.
    await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const result = await tx.execute<{ deleted_count: number }>(sql`
      WITH expired AS (
        SELECT code FROM duoxing_rooms
        WHERE expires_at <= CURRENT_TIMESTAMP
        ORDER BY expires_at, code
        LIMIT ${ROOM_CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      ), deleted AS (
        DELETE FROM duoxing_rooms AS rooms
        USING expired
        WHERE rooms.code = expired.code
          AND rooms.expires_at <= CURRENT_TIMESTAMP
        RETURNING 1
      )
      SELECT count(*)::integer AS deleted_count FROM deleted
    `);
    // The existing FK cascades atomically remove participants and private drafts.
    return result.rows[0].deleted_count;
  });
}

export async function cleanupExpiredRooms(): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < ROOM_CLEANUP_MAX_BATCHES; batch += 1) {
    const deleted = await deleteExpiredRoomBatch();
    total += deleted;
    if (deleted < ROOM_CLEANUP_BATCH_SIZE) break;
  }
  return total;
}
