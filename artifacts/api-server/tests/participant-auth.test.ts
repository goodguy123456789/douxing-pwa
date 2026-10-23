import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, duoxingParticipantsTable as participants, duoxingRoomsTable as rooms } from "@workspace/db";
import { authMode, issueCredential, hashToken, authenticateParticipant, assertTokenCutoverReady } from "../src/lib/participant-auth";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import { once } from "node:events";
import roomsRouter from "../src/routes/rooms";

const base = `${(process.env.DUOXING_TEST_BASE_URL ?? "http://localhost:80").replace(/\/$/, "")}/api`;
const fixtures: string[] = [];
after(async () => {
  if (fixtures.length) await db.delete(rooms).where(inArray(rooms.code, fixtures));
  await pool.end();
});
async function request(path: string, token?: string, method = "GET", body?: unknown) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "X-Duoxing-Auth": "token-v1", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
async function create() {
  const result = await request("/rooms", undefined, "POST", {});
  assert.equal(result.status, 201);
  fixtures.push(result.data.roomCode);
  return result.data as { roomCode: string; participantId: string; participantToken: string; expiresAt: string };
}
async function pair() {
  const a = await create();
  const b = await request(`/rooms/${a.roomCode}/join`, undefined, "POST", {});
  assert.equal(b.status, 201);
  return { a, b: b.data as typeof a, path: `/rooms/${a.roomCode}` };
}
const preferences = (id?: string) => ({
  ...(id ? { participantId: id } : {}), preferenceRevision: 1, nickname: "仅本人可见",
  budget: "2", distance: "3", spice: "none",
  cuisinePreferences: [{ cuisine: "日料", attitude: "love" }],
});

test("creation, joining and authenticated recovery return the database room expiry unchanged", async () => {
  const { a, b, path } = await pair();
  const [row] = await db.select({ expiresAt: rooms.expiresAt }).from(rooms).where(eq(rooms.code, a.roomCode));
  const expected = row.expiresAt.toISOString();
  assert.equal(a.expiresAt, expected);
  assert.equal(b.expiresAt, expected);
  const recovered = await request(`${path}/me`, a.participantToken);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.expiresAt, expected);
  assert.equal((await request(`${path}/me`)).data.expiresAt, undefined);
});

test("four fixed server lifetimes and omitted legacy 24h default; lifecycle operations never extend them", async t => {
  for (const hours of [1, 3, 12, 24, undefined]) await t.test(`${hours ?? "legacy"} hours`, async () => {
    const created = await request("/rooms", undefined, "POST", hours === undefined ? {} : { durationHours: hours });
    assert.equal(created.status, 201);
    const a = created.data;
    fixtures.push(a.roomCode);
    const path = `/rooms/${a.roomCode}`;
    const [row] = await db.select().from(rooms).where(eq(rooms.code, a.roomCode));
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), (hours ?? 24) * 3600000);
    const expiry = row.expiresAt.toISOString();
    assert.equal(a.expiresAt, expiry);
    const b = await request(`${path}/join`, undefined, "POST", {});
    assert.equal(b.status, 201);
    assert.equal(b.data.expiresAt, expiry);
    for (let i = 0; i < 2; i++) {
      const restored = await request(`${path}/me`, a.participantToken);
      assert.equal(restored.status, 200);
      assert.equal(restored.data.expiresAt, expiry);
    }
    assert.equal((await request(`${path}/preferences`, a.participantToken, "PUT", preferences(a.participantId))).status, 200);
    const revealed = await request(`${path}/preferences`, b.data.participantToken, "PUT", preferences(b.data.participantId));
    assert.equal(revealed.status, 200);
    assert.equal(revealed.data.state, "revealed");
    assert.equal((await request(`${path}/recommendations/reroll`, a.participantToken, "POST", { participantId: a.participantId })).status, 200);
    assert.equal((await request(`${path}/reset`, a.participantToken, "POST", { participantId: a.participantId })).status, 200);
    const [after] = await db.select().from(rooms).where(eq(rooms.code, a.roomCode));
    assert.equal(after.expiresAt.toISOString(), expiry);
    assert.equal(after.createdAt.toISOString(), row.createdAt.toISOString());
    assert.equal((await request(`${path}/me`, a.participantToken)).data.expiresAt, expiry);

    // Controlled server-owned timestamps simulate reaching each selected lifetime.
    await db.update(rooms).set({ createdAt: new Date(Date.now() - (hours ?? 24) * 3600000 - 1000), expiresAt: new Date(Date.now() - 1000) }).where(eq(rooms.code, a.roomCode));
    for (const [suffix, method, body] of [
      ["me", "GET", undefined],
      ["join", "POST", {}],
      ["preferences", "PUT", { ...preferences(a.participantId), preferenceRevision: 2 }],
      ["reset", "POST", { participantId: a.participantId }],
      ["recommendations/reroll", "POST", { participantId: a.participantId }],
      [`participants/${a.participantId}`, "GET", undefined],
    ] as const) {
      const denied = await request(`${path}/${suffix}`, a.participantToken, method, body);
      assert.equal(denied.status, suffix === "join" ? 404 : suffix.startsWith("participants/") ? 426 : 401);
      assert.equal(denied.data.ownDraft, undefined);
      assert.equal(denied.data.recommendations, undefined);
    }
  });
});

test("strict duration validation rejects null, strings, fractions, unsupported numbers and client expiry", async () => {
  for (const durationHours of [null, 0, -1, 1.5, 2, 25, 48, "12", "", true, [], {}]) {
    assert.equal((await request("/rooms", undefined, "POST", { durationHours })).status, 400);
  }
  for (const expiresAt of [null, "2099-01-01T00:00:00Z"]) {
    assert.equal((await request("/rooms", undefined, "POST", { durationHours: 12, expiresAt })).status, 400);
  }
});

test("tokens have 256 random bits, are independent, and storage uses SHA-256", () => {
  const a = issueCredential("token"), b = issueCredential("token");
  assert.ok(/^[a-f0-9]{64}$/.test(a.participantToken!));
  assert.ok(a.participantToken !== b.participantToken);
  assert.ok(a.tokenHash !== a.participantToken);
  assert.ok(a.tokenHash === hashToken(a.participantToken!));
  assert.equal(issueCredential("legacy").tokenHash, null);
  assert.equal(issueCredential("drain").participantToken, undefined);
});
test("unknown authentication modes fail closed", () => {
  const before = process.env.DUOXING_AUTH_MODE;
  try { process.env.DUOXING_AUTH_MODE = "typo"; assert.throws(authMode); }
  finally { if (before === undefined) delete process.env.DUOXING_AUTH_MODE; else process.env.DUOXING_AUTH_MODE = before; }
});
test("A and B receive independent tokens and only hashes are persisted", async () => {
  const { a, b } = await pair();
  assert.ok(a.participantId !== b.participantId);
  assert.ok(a.participantToken !== b.participantToken);
  assert.ok(a.participantToken !== a.participantId);
  const rows = await db.select().from(participants).where(eq(participants.roomCode, a.roomCode));
  assert.ok(rows.every(p => p.tokenHash !== null && p.tokenHash !== a.participantToken && p.tokenHash !== b.participantToken));
  assert.ok(rows.find(p => p.id === a.participantId)?.tokenHash === hashToken(a.participantToken));
});
test("room code alone and missing or malformed tokens do not authenticate", async () => {
  const a = await create(), path = `/rooms/${a.roomCode}/me`;
  for (const token of [undefined, "invalid", "f".repeat(64)]) {
    const result = await request(path, token);
    assert.equal(result.status, 401);
    assert.equal(result.data.ownDraft, undefined);
    assert.match(result.data.error, /刷新/);
  }
});
test("knowing participantId never grants token-room access", async () => {
  const a = await create();
  assert.equal((await request(`/rooms/${a.roomCode}/me`, a.participantId)).status, 401);
  assert.equal((await request(`/rooms/${a.roomCode}/preferences`, undefined, "PUT", preferences(a.participantId))).status, 401);
});
test("a valid token from another room is rejected", async () => {
  const a = await create(), b = await create();
  assert.equal((await request(`/rooms/${a.roomCode}/me`, b.participantToken)).status, 401);
});
test("A's token cannot read B's draft, even with a misleading public ID header", async () => {
  const { a, b, path } = await pair();
  assert.equal((await request(`${path}/preferences`, a.participantToken, "PUT", preferences(a.participantId))).status, 200);
  const own = await request(`${path}/me`, a.participantToken);
  const other = await request(`${path}/me`, b.participantToken);
  assert.equal(own.data.ownDraft.nickname, "仅本人可见");
  assert.equal(other.data.ownDraft, null);
  const response = await fetch(base + `${path}/me`, { headers: { Authorization: `Bearer ${b.participantToken}`, participantId: a.participantId } });
  assert.equal((await response.json()).ownDraft, null);
});
test("B's token cannot save preferences or run room actions as A", async () => {
  const { a, b, path } = await pair();
  for (const [suffix, method, body] of [
    ["preferences", "PUT", preferences(a.participantId)],
    ["reset", "POST", { participantId: a.participantId }],
    ["recommendations/reroll", "POST", { participantId: a.participantId }],
  ] as const) assert.equal((await request(`${path}/${suffix}`, b.participantToken, method, body)).status, 403);
  assert.equal((await request(`${path}/me`, a.participantToken)).data.ownDraft, null);
});
test("server can derive submission identity without a body participantId", async () => {
  const a = await create();
  const result = await request(`/rooms/${a.roomCode}/preferences`, a.participantToken, "PUT", preferences());
  assert.equal(result.status, 200);
  assert.ok(result.data.participantId === a.participantId);
});
test("all protected mutations reject absent tokens before changing state", async () => {
  const a = await create(), path = `/rooms/${a.roomCode}`;
  for (const [suffix, method, body] of [
    ["preferences", "PUT", preferences(a.participantId)],
    ["reset", "POST", { participantId: a.participantId }],
    ["recommendations/reroll", "POST", { participantId: a.participantId }],
  ] as const) assert.equal((await request(`${path}/${suffix}`, undefined, method, body)).status, 401);
  assert.equal((await request(`${path}/me`, a.participantToken)).data.submittedCount, 0);
});
test("old URL route is retired even with an otherwise valid new token", async () => {
  const a = await create();
  for (const token of [undefined, a.participantId, a.participantToken]) {
    const result = await request(`/rooms/${a.roomCode}/participants/${a.participantId}`, token);
    assert.equal(result.status, 426);
    assert.match(result.data.error, /刷新/);
    assert.equal(result.data.ownDraft, undefined);
  }
});
test("old cached clients cannot create orphan identities or consume a room's last slot", async () => {
  const a = await create();
  for (const path of ["/rooms", `/rooms/${a.roomCode}/join`]) {
    const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 426);
    assert.match((await response.json()).error, /刷新/);
  }
  assert.equal((await request(`/rooms/${a.roomCode}/me`, a.participantToken)).data.participantCount, 1);
});
test("credential and private responses cannot enter shared caches", async () => {
  const a = await create();
  const result = await request(`/rooms/${a.roomCode}/me`, a.participantToken);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const joined = await request(`/rooms/${a.roomCode}/join`, undefined, "POST", {});
  assert.equal(joined.headers.get("cache-control"), "no-store");
  const created = await request("/rooms", undefined, "POST", {});
  fixtures.push(created.data.roomCode);
  assert.equal(created.headers.get("cache-control"), "no-store");
});
test("encoded paths and case variants cannot bypass authentication", async () => {
  const a = await create();
  const encoded = `%${a.roomCode.charCodeAt(0).toString(16)}${a.roomCode.slice(1)}`;
  for (const path of [`/rooms/${encoded}/preferences`, `/ROOMS/${a.roomCode}/PREFERENCES`]) {
    assert.equal((await request(path, undefined, "PUT", preferences(a.participantId))).status, 401);
  }
  assert.equal((await request(`/ROOMS/${a.roomCode}/PARTICIPANTS/${a.participantId}`, a.participantToken)).status, 426);
});
test("expired tokens cannot read, submit, reset, reroll or join", async () => {
  const a = await create(), path = `/rooms/${a.roomCode}`;
  await db.update(rooms).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(rooms.code, a.roomCode));
  for (const [suffix, method, body] of [
    ["me", "GET", undefined], ["preferences", "PUT", preferences(a.participantId)],
    ["reset", "POST", { participantId: a.participantId }],
    ["recommendations/reroll", "POST", { participantId: a.participantId }],
  ] as const) assert.equal((await request(`${path}/${suffix}`, a.participantToken, method, body)).status, 401);
  assert.equal((await request(`${path}/join`, undefined, "POST", {})).status, 404);
});

// Exercise compatibility policies locally without changing the running service mode.
async function middleware(path: string, mode: string, body?: object, bearer?: string) {
  const before = process.env.DUOXING_AUTH_MODE;
  let status = 200, nextCalled = false;
  let data: unknown;
  const response = { locals: {}, set() { return this; }, status(code: number) { status = code; return this; }, json(value: unknown) { data = value; return this; } };
  try {
    process.env.DUOXING_AUTH_MODE = mode;
    await authenticateParticipant({
      path, body, method: body ? "POST" : "GET", get: () => bearer ? `Bearer ${bearer}` : undefined,
    } as unknown as Request, response as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    return { status, nextCalled, data };
  } finally { if (before === undefined) delete process.env.DUOXING_AUTH_MODE; else process.env.DUOXING_AUTH_MODE = before; }
}
test("expiry marker requires a matching token and never authorizes expired reads or writes", async () => {
  // Create and expire a development-only fixture, then inspect safe metadata.
  const a = await create();
  await db.update(rooms).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(rooms.code, a.roomCode));
  const result = await middleware(`/rooms/${a.roomCode}/me`, "token", undefined, a.participantToken);
  assert.equal(result.status, 401);
  assert.equal(result.nextCalled, false);
  assert.deepEqual(result.data, { error: "房间已过期，无法继续使用。", code: "ROOM_EXPIRED" });
  for (const token of [undefined, a.participantId, "f".repeat(64)]) {
    const denied = await middleware(`/rooms/${a.roomCode}/me`, "token", undefined, token);
    assert.equal(denied.status, 401);
    assert.equal(denied.nextCalled, false);
    assert.equal((denied.data as { code?: string }).code, undefined);
  }
  const write = await middleware(`/rooms/${a.roomCode}/preferences`, "token", preferences(a.participantId), a.participantToken);
  assert.equal(write.status, 401);
  assert.equal(write.nextCalled, false);
  assert.equal((write.data as { code?: string }).code, undefined);
});
test("rollback/drain cannot authenticate token participants merely by ID", async () => {
  const a = await create();
  for (const mode of ["legacy", "drain"]) {
    const result = await middleware(`/rooms/${a.roomCode}/participants/${a.participantId}`, mode);
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 404);
  }
});
test("valid legacy rooms work during drain, expired legacy IDs cannot bypass expiry", async () => {
  const code = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(), id = randomUUID();
  fixtures.push(code);
  await db.insert(rooms).values({ code, expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(participants).values({ id, roomCode: code, nickname: "兼容测试", participantIndex: 1 });
  const path = `/rooms/${code}/participants/${id}`;
  assert.equal((await middleware(path, "drain")).nextCalled, true);
  assert.equal((await middleware(path, "token")).status, 426);
  await assert.rejects(assertTokenCutoverReady(), /active legacy rooms/);
  await db.update(rooms).set({ expiresAt: new Date(0) }).where(eq(rooms.code, code));
  for (const suffix of [`participants/${id}`, "me", "preferences", "reset", "recommendations/reroll"]) {
    const result = await middleware(`/rooms/${code}/${suffix}`, "drain", suffix === "me" || suffix.startsWith("participants/") ? undefined : { participantId: id }, id);
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 404);
  }
});
test("cutover guard accepts only an actual zero database result, not an elapsed timer", async () => {
  await assertTokenCutoverReady({ execute: async () => ({ rows: [{ active_legacy_rooms: 0 }] }) } as unknown as Pick<typeof db, "execute">);
  await assert.rejects(assertTokenCutoverReady({ execute: async () => ({ rows: [{ active_legacy_rooms: 1 }] }) } as unknown as Pick<typeof db, "execute">));
  await assert.rejects(assertTokenCutoverReady({ execute: async () => ({ rows: [] }) } as unknown as Pick<typeof db, "execute">));
});
test("drain blocks creation with friendly upgrade guidance while existing legacy rooms remain usable", async () => {
  const before = process.env.DUOXING_AUTH_MODE;
  const code = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(), id = randomUUID();
  fixtures.push(code);
  await db.insert(rooms).values({ code, expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(participants).values({ id, roomCode: code, nickname: "旧房间", participantIndex: 1 });
  const app = express();
  app.use(express.json());
  app.use("/api", roomsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api`;
  const tokenRoom = await create();
  try {
    process.env.DUOXING_AUTH_MODE = "drain";
    const blocked = await fetch(url + "/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(blocked.status, 503);
    assert.match((await blocked.json()).error, /安全升级/);
    assert.equal(blocked.headers.get("retry-after"), "3600");
    const status = await fetch(`${url}/rooms/${code}/participants/${id}`);
    assert.equal(status.status, 200);
    const joined = await fetch(`${url}/rooms/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(joined.status, 201);
    assert.equal((await joined.json()).participantToken, undefined);
    const tokenJoined = await fetch(`${url}/rooms/${tokenRoom.roomCode}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(tokenJoined.status, 201);
    assert.ok(/^[a-f0-9]{64}$/.test((await tokenJoined.json()).participantToken));
  } finally {
    if (before === undefined) delete process.env.DUOXING_AUTH_MODE; else process.env.DUOXING_AUTH_MODE = before;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
