import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { db, duoxingParticipantsTable as participants, duoxingRoomsTable as rooms } from "@workspace/db";

export type AuthMode = "legacy" | "drain" | "token";
export function authMode(): AuthMode {
  const mode = process.env.DUOXING_AUTH_MODE ?? "legacy";
  if (mode !== "legacy" && mode !== "drain" && mode !== "token") {
    throw new Error("Invalid anonymous authentication mode");
  }
  return mode;
}
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function issueCredential(mode = authMode()) {
  if (mode !== "token") return { participantToken: undefined, tokenHash: null };
  const participantToken = randomBytes(32).toString("hex");
  return { participantToken, tokenHash: hashToken(participantToken) };
}
export async function assertTokenCutoverReady(database: Pick<typeof db, "execute"> = db) {
  const result = await database.execute(sql`
    SELECT COUNT(DISTINCT r.code)::int AS active_legacy_rooms
    FROM duoxing_rooms r
    JOIN duoxing_participants p ON p.room_code = r.code
    WHERE r.expires_at > CURRENT_TIMESTAMP AND p.token_hash IS NULL`);
  if (Number(result.rows[0]?.active_legacy_rooms) !== 0) {
    throw new Error("Token cutover blocked: active legacy rooms remain");
  }
}

// Runs before body validation: old cached clients get upgrade guidance, not Zod errors.
export const authenticateParticipant: RequestHandler = async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const mode = authMode();
  let path: string;
  try { path = decodeURIComponent(req.path); }
  catch { res.status(400).json({ error: "请求格式不正确，请刷新页面后重试。" }); return; }
  if (/^\/rooms\/?$/i.test(path) || /^\/rooms\/[a-z0-9]{4,6}\/join\/?$/i.test(path)) {
    if (mode === "token" && req.get("x-duoxing-auth") !== "token-v1") {
      res.status(426).json({ error: "应用已升级，请联网刷新页面后再创建或加入房间。" });
      return;
    }
    next(); return;
  }
  const match = path.match(/^\/rooms\/([a-z0-9]{4,6})\/(me|participants\/[^/]+|preferences|reset|recommendations\/reroll)\/?$/i);
  if (!match) { next(); return; }
  const isLegacyRoute = match[2].toLowerCase().startsWith("participants/");
  if (mode === "token" && isLegacyRoute) {
    res.status(426).json({ error: "应用已升级，请联网刷新页面或重新打开都行。旧房间身份不能继续使用。" });
    return;
  }
  const header = req.get("authorization");
  const bearer = header?.match(/^Bearer ([^\s]+)$/i)?.[1];
  const legacyId = isLegacyRoute ? match[2].slice(13) : req.body?.participantId;
  if (mode !== "token") {
    const id = bearer ?? legacyId;
    // Even during rollback/drain, never let an ID authenticate a token identity.
    if (!bearer || !/^[a-f0-9]{64}$/.test(bearer)) {
      const [legacy] = typeof id === "string" ? await db.select({ id: participants.id, tokenHash: participants.tokenHash })
        .from(participants).innerJoin(rooms, eq(rooms.code, participants.roomCode))
        .where(and(eq(participants.id, id), eq(participants.roomCode, match[1].toUpperCase()),
          sql`${rooms.expiresAt} > CURRENT_TIMESTAMP`)).limit(1) : [];
      if (!legacy || legacy.tokenHash !== null) {
        res.status(404).json({ error: "房间或参与者不存在，或房间已过期。请刷新页面。" });
        return;
      }
      res.locals.participantId = legacy.id;
      next(); return;
    }
  }
  if (!bearer || !/^[a-f0-9]{64}$/.test(bearer)) {
    res.status(401).json({ error: "身份已失效或页面版本过旧，请联网刷新页面后重试。" });
    return;
  }
  const [participant] = await db.select({
    id: participants.id,
    active: sql<boolean>`${rooms.expiresAt} > CURRENT_TIMESTAMP`,
  })
    .from(participants).innerJoin(rooms, eq(rooms.code, participants.roomCode))
    .where(and(eq(participants.roomCode, match[1].toUpperCase()), eq(participants.tokenHash, hashToken(bearer)))).limit(1);
  if (!participant) {
    res.status(401).json({ error: "身份已失效或房间已过期，请刷新页面后重试。" });
    return;
  }
  if (!participant.active) {
    // Disclose expiry only to a matching credential on a read. Never return
    // room contents or let expired credentials reach the protected handlers.
    res.status(401).json({
      error: "房间已过期，无法继续使用。",
      ...(req.method === "GET" ? { code: "ROOM_EXPIRED" } : {}),
    });
    return;
  }
  // A body ID is only a consistency assertion, never an authentication secret.
  if (req.body?.participantId !== undefined && req.body.participantId !== participant.id) {
    res.status(403).json({ error: "不能修改其他参与者的选择，请刷新页面。" });
    return;
  }
  res.locals.participantId = participant.id;
  if (req.method !== "GET") req.body = { ...req.body, participantId: participant.id };
  next();
};
