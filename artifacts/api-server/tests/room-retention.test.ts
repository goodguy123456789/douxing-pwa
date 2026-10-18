import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, duoxingRoomsTable as rooms,
  duoxingParticipantsTable as participants, duoxingPreferencesTable as preferences,
} from "@workspace/db";
import { deleteExpiredRoomBatch, ROOM_CLEANUP_BATCH_SIZE } from "../src/lib/room-cleanup";

after(async () => { await pool.end(); });
const rollback = new Error("rollback retention fixtures");
const code = () => randomUUID().replaceAll("-", "").slice(0, 6);
const saved = (participantId: string) => ({
  participantId, budget: "2", distance: "3", spice: "none",
  cuisinePreferences: [{ cuisine: "日料", attitude: "love" as const }],
});

test("expiry boundary cascades to participants and retained drafts; active rooms stay byte-for-byte intact", async () => {
  await assert.rejects(db.transaction(async tx => {
    const expiredCode = code(), activeCode = code();
    const expiredId = randomUUID(), activeId = randomUUID();
    await tx.insert(rooms).values([
      { code: expiredCode, expiresAt: sql`CURRENT_TIMESTAMP` },
      { code: activeCode, expiresAt: sql`CURRENT_TIMESTAMP + interval '1 day'`, round: 3 },
    ]);
    await tx.insert(participants).values([
      { id: expiredId, roomCode: expiredCode, nickname: "到期", participantIndex: 1 },
      { id: activeId, roomCode: activeCode, nickname: "有效", participantIndex: 1 },
    ]);
    // submittedAt is null: these are retained drafts, not just current votes.
    await tx.insert(preferences).values([saved(expiredId), saved(activeId)]);
    const snapshot = async () => ({
      room: await tx.select().from(rooms).where(eq(rooms.code, activeCode)),
      participant: await tx.select().from(participants).where(eq(participants.id, activeId)),
      draft: await tx.select().from(preferences).where(eq(preferences.participantId, activeId)),
    });
    const before = await snapshot();
    // Drain pre-existing expired records too, all within this rolled-back transaction.
    let count: number;
    do { count = await deleteExpiredRoomBatch(tx); } while (count === ROOM_CLEANUP_BATCH_SIZE);
    assert.deepEqual(await tx.select().from(rooms).where(eq(rooms.code, expiredCode)), []);
    assert.deepEqual(await tx.select().from(participants).where(eq(participants.id, expiredId)), []);
    assert.deepEqual(await tx.select().from(preferences).where(eq(preferences.participantId, expiredId)), []);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await deleteExpiredRoomBatch(tx), 0);
    throw rollback;
  }), error => error === rollback);
});

test("cleanup bounds each batch and can continue draining a backlog", async () => {
  await assert.rejects(db.transaction(async tx => {
    const codes = Array.from({ length: ROOM_CLEANUP_BATCH_SIZE + 1 }, code);
    await tx.insert(rooms).values(codes.map(code => ({ code, expiresAt: new Date("2000-01-01") })));
    assert.equal(await deleteExpiredRoomBatch(tx), ROOM_CLEANUP_BATCH_SIZE);
    const remaining = await tx.select().from(rooms).where(inArray(rooms.code, codes));
    assert.ok(remaining.length >= 1, "one batch must not delete the whole backlog");
    let count: number;
    do { count = await deleteExpiredRoomBatch(tx); } while (count === ROOM_CLEANUP_BATCH_SIZE);
    assert.deepEqual(await tx.select().from(rooms).where(inArray(rooms.code, codes)), []);
    throw rollback;
  }), error => error === rollback);
});

test("a room locked by another transaction is skipped without blocking cleanup", async () => {
  const roomCode = code();
  await db.insert(rooms).values({ code: roomCode, expiresAt: new Date("2000-01-01") });
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT code FROM duoxing_rooms WHERE code = ${roomCode} FOR UPDATE`);
      await deleteExpiredRoomBatch();
      assert.equal((await tx.select().from(rooms).where(eq(rooms.code, roomCode))).length, 1);
    });
  } finally {
    await db.delete(rooms).where(eq(rooms.code, roomCode));
  }
});

test("all expired-room API access is rejected before cleanup and cannot alter saved data", async () => {
  const base = "http://localhost:80/api";
  let token = "";
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  const created = await request("/rooms", "POST", {});
  assert.equal(created.status, 201);
  const { roomCode, participantId } = created.data;
  token = created.data.participantToken ?? "";
  try {
    const payload = { ...saved(participantId), preferenceRevision: 1 };
    assert.equal((await request(`/rooms/${roomCode}/preferences`, "PUT", payload)).status, 200);
    await db.update(rooms).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(rooms.code, roomCode));
    for (const [suffix, method, body] of [
      ["me", "GET", undefined],
      ["join", "POST", {}],
      ["preferences", "PUT", payload],
      ["reset", "POST", { participantId }],
      ["recommendations/reroll", "POST", { participantId }],
    ] as const) {
      const result = await request(`/rooms/${roomCode}/${suffix}`, method, body);
      assert.equal(result.status, suffix === "join" || !token ? 404 : 401, suffix);
      assert.equal(result.data.ownDraft, undefined);
      assert.equal(result.data.recommendations, undefined);
    }
    // Cleanup may already have run; otherwise the expired draft must be unchanged.
    const remaining = await db.select().from(preferences).where(eq(preferences.participantId, participantId));
    if (remaining.length) {
      assert.equal(remaining[0].budget, "2");
      assert.deepEqual(remaining[0].cuisinePreferences, payload.cuisinePreferences);
    }
  } finally {
    await db.delete(rooms).where(eq(rooms.code, roomCode));
  }
});
