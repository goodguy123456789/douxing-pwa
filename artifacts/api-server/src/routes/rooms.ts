import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateRoomBody,
  CreateRoomResponse,
  GetRoomParams,
  GetRoomResponse,
  JoinRoomBody,
  JoinRoomParams,
  JoinRoomResponse,
  RerollRecommendationsBody,
  RerollRecommendationsParams,
  ResetRoomBody,
  ResetRoomParams,
  ResetRoomResponse,
  SubmitPreferencesBody,
  SubmitPreferencesParams,
  SubmitPreferencesResponse,
} from "@workspace/api-zod";
import type { RestaurantRecommendation } from "@workspace/api-zod";
import {
  db,
  duoxingParticipantsTable,
  duoxingPreferencesTable,
  duoxingRoomsTable,
} from "@workspace/db";
import { getRecommendations } from "../lib/meal-recommendations";
import { ALGORITHM_VERSION } from "../lib/match-engine";

const router: IRouter = Router();
const ROOM_SIZE = 2;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomCode(): string {
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code +=
      ROOM_CODE_CHARACTERS[
        Math.floor(Math.random() * ROOM_CODE_CHARACTERS.length)
      ];
  }
  return code;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function errorResponse(message: string) {
  return { error: message };
}

async function getParticipantStatus(roomCode: string, participantId: string) {
  // Serialize the entire snapshot with submit/reset/reroll; never mix two rounds.
  return db.transaction(async (tx) => {
  const [room] = await tx.select().from(duoxingRoomsTable)
    .where(eq(duoxingRoomsTable.code, roomCode)).for("update").limit(1);
  if (!room || room.expiresAt <= new Date()) return null;

  const participants = await tx
    .select()
    .from(duoxingParticipantsTable)
    .where(eq(duoxingParticipantsTable.roomCode, roomCode));
  const participant = participants.find((entry) => entry.id === participantId);
  if (!participant) return null;

  const saved = await tx.select().from(duoxingPreferencesTable)
    .where(inArray(duoxingPreferencesTable.participantId, participants.map(p => p.id)));
  const valid = participants.filter(p => p.submittedAt !== null && saved.some(s =>
    s.participantId === p.id && SubmitPreferencesBody.safeParse({ ...s, participantId: p.id, preferenceRevision: room.round }).success));
  const submittedCount = valid.length;
  const revealed = participants.length === ROOM_SIZE && submittedCount === ROOM_SIZE;
  const ownPreferences = saved.find(p => p.participantId === participant.id);
  // The anonymous participant ID is a bearer credential. Project only its owner's
  // draft; never send the saved array, partner IDs, or persistence metadata.
  const draft = GetRoomResponse.shape.ownDraft.safeParse(ownPreferences ? {
    nickname: participant.nickname,
    budget: ownPreferences.budget,
    distance: ownPreferences.distance,
    cuisinePreferences: ownPreferences.cuisinePreferences,
    spice: ownPreferences.spice,
  } : null);

  let recommendations: RestaurantRecommendation[] = [];
  let hasMoreRecommendations = false;
  let candidateCount = 0;
  if (revealed) {
    if (saved.length === participants.length) {
      const result = getRecommendations(
        participants.map((entry) => {
          const preferences = saved.find(
            (savedPreferences) => savedPreferences.participantId === entry.id,
          );
          if (!preferences) {
            throw new Error("A submitted participant is missing preferences.");
          }
          return SubmitPreferencesBody.parse({
            participantId: entry.id,
            preferenceRevision: room.round,
            budget: preferences.budget,
            distance: preferences.distance,
            cuisinePreferences: preferences.cuisinePreferences,
            spice: preferences.spice,
          });
        }),
        room.recommendationPage,
      );
      recommendations = result.recommendations as RestaurantRecommendation[];
      hasMoreRecommendations = result.hasMoreRecommendations;
      candidateCount = result.candidateCount;
    }
  }

  const state = revealed
    ? "revealed"
    : valid.some(p => p.id === participant.id)
      ? participants.length < ROOM_SIZE
        ? "waiting_for_partner"
        : "waiting_for_other"
      : "choosing";

  return GetRoomResponse.parse({
    roomCode,
    participantId,
    participantCount: participants.length,
    submittedCount,
    requiredParticipantCount: ROOM_SIZE,
    hasSubmitted: valid.some(p => p.id === participant.id),
    ownDraft: draft.success ? draft.data : null,
    preferenceRevision: room.round,
    algorithmVersion: ALGORITHM_VERSION,
    hasMoreRecommendations,
    candidateCount,
    state,
    recommendations,
  });
  });
}

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json(errorResponse(parsed.error.message));
    return;
  }

  const nickname = parsed.data.nickname?.trim() || "参与者 1";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomCode = createRoomCode();
    const participantId = randomUUID();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(duoxingRoomsTable).values({
          code: roomCode,
          expiresAt: new Date(Date.now() + ROOM_LIFETIME_MS),
        });
        await tx.insert(duoxingParticipantsTable).values({
          id: participantId,
          roomCode,
          participantIndex: 1,
          nickname,
        });
      });

      res
        .status(201)
        .json(CreateRoomResponse.parse({ roomCode, participantId }));
      return;
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 7) throw error;
    }
  }
});

router.get(
  "/rooms/:roomCode/participants/:participantId",
  async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const params = GetRoomParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(errorResponse(params.error.message));
      return;
    }

    const status = await getParticipantStatus(
      params.data.roomCode,
      params.data.participantId,
    );
    if (!status) {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }

    res.json(status);
  },
);

router.post(
  "/rooms/:roomCode/join",
  async (req, res): Promise<void> => {
    const params = JoinRoomParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(errorResponse(params.error.message));
      return;
    }
    const body = JoinRoomBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json(errorResponse(body.error.message));
      return;
    }

    const roomCode = params.data.roomCode.toUpperCase();
    const participantId = randomUUID();
    const nickname = body.data.nickname?.trim() || "参与者 2";
    const outcome = await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(duoxingRoomsTable)
        .where(eq(duoxingRoomsTable.code, roomCode))
        .for("update")
        .limit(1);
      if (!room || room.expiresAt <= new Date()) return "not_found";

      const participants = await tx
        .select()
        .from(duoxingParticipantsTable)
        .where(eq(duoxingParticipantsTable.roomCode, roomCode));
      if (participants.length >= ROOM_SIZE) return "full";

      await tx.insert(duoxingParticipantsTable).values({
        id: participantId,
        roomCode,
        participantIndex: participants.length + 1,
        nickname,
      });
      return "joined";
    });

    if (outcome === "not_found") {
      res.status(404).json(errorResponse("没有找到这个房间，检查一下房间码。"));
      return;
    }
    if (outcome === "full") {
      res.status(409).json(errorResponse("这个房间已经坐满两个人了。"));
      return;
    }

    res
      .status(201)
      .json(JoinRoomResponse.parse({ roomCode, participantId }));
  },
);

router.put(
  "/rooms/:roomCode/preferences",
  async (req, res): Promise<void> => {
    const params = SubmitPreferencesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(errorResponse(params.error.message));
      return;
    }
    const body = SubmitPreferencesBody.safeParse(req.body);
    if (!body.success) {
      const revisionIssue = body.error.issues.some(issue => issue.path[0] === "preferenceRevision");
      res.status(400).json(errorResponse(revisionIssue
        ? "页面版本过旧或尚未同步，请刷新页面后重新填写并提交；这次选择尚未保存。"
        : body.error.message));
      return;
    }
    if (new Set(body.data.cuisinePreferences.map(p => p.cuisine)).size !== body.data.cuisinePreferences.length) {
      res.status(400).json(errorResponse("同一菜系只能提交一种偏好。"));
      return;
    }

    const roomCode = params.data.roomCode.toUpperCase();
    const submitted = await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(duoxingRoomsTable)
        .where(eq(duoxingRoomsTable.code, roomCode))
        .for("update")
        .limit(1);
      if (!room || room.expiresAt <= new Date()) return "not_found";

      const participants = await tx
        .select()
        .from(duoxingParticipantsTable)
        .where(eq(duoxingParticipantsTable.roomCode, roomCode));
      const participant = participants.find(
        (entry) => entry.id === body.data.participantId,
      );
      if (!participant) return "not_found";
      if (body.data.preferenceRevision !== undefined && body.data.preferenceRevision !== room.round) {
        return "stale_revision";
      }
      // A repeated submission changes the preference set and invalidates EVERY old vote.
      if (participant.submittedAt !== null) {
        await tx.update(duoxingParticipantsTable).set({ submittedAt: null })
          .where(eq(duoxingParticipantsTable.roomCode, roomCode));
        await tx.update(duoxingRoomsTable).set({ round: room.round + 1, recommendationPage: 0 })
          .where(eq(duoxingRoomsTable.code, roomCode));
      }

      const now = new Date();
      await tx
        .insert(duoxingPreferencesTable)
        .values({
          participantId: participant.id,
          budget: body.data.budget,
          distance: body.data.distance,
          cuisinePreferences: body.data.cuisinePreferences,
          spice: body.data.spice,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: duoxingPreferencesTable.participantId,
          set: {
            budget: body.data.budget,
            distance: body.data.distance,
            cuisinePreferences: body.data.cuisinePreferences,
            spice: body.data.spice,
            updatedAt: now,
          },
        });
      await tx
        .update(duoxingParticipantsTable)
        .set({
          submittedAt: now,
          ...(body.data.nickname !== undefined
            ? { nickname: body.data.nickname.trim() || participant.nickname }
            : {}),
        })
        .where(eq(duoxingParticipantsTable.id, participant.id));
      return "submitted";
    });

    if (submitted === "not_found") {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }
    if (submitted === "stale_revision") {
      res.status(400).json(errorResponse("偏好版本已更新，请刷新页面后重新提交。"));
      return;
    }

    const status = await getParticipantStatus(
      roomCode,
      body.data.participantId,
    );
    if (!status) {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }
    res.json(SubmitPreferencesResponse.parse(status));
  },
);

router.post(
  "/rooms/:roomCode/reset",
  async (req, res): Promise<void> => {
    const params = ResetRoomParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(errorResponse(params.error.message));
      return;
    }
    const body = ResetRoomBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(errorResponse(body.error.message));
      return;
    }

    const roomCode = params.data.roomCode.toUpperCase();
    const reset = await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(duoxingRoomsTable)
        .where(eq(duoxingRoomsTable.code, roomCode))
        .for("update")
        .limit(1);
      if (!room || room.expiresAt <= new Date()) return "not_found";

      const participants = await tx
        .select()
        .from(duoxingParticipantsTable)
        .where(eq(duoxingParticipantsTable.roomCode, roomCode));
      if (!participants.some((entry) => entry.id === body.data.participantId)) {
        return "not_found";
      }
      if (participants.length > 0) {
        await tx
          .update(duoxingParticipantsTable)
          .set({ submittedAt: null })
          .where(eq(duoxingParticipantsTable.roomCode, roomCode));
      }
      await tx
        .update(duoxingRoomsTable)
        .set({ round: room.round + 1, recommendationPage: 0 })
        .where(eq(duoxingRoomsTable.code, roomCode));
      return "reset";
    });

    if (reset === "not_found") {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }

    const status = await getParticipantStatus(
      roomCode,
      body.data.participantId,
    );
    if (!status) {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }
    res.json(ResetRoomResponse.parse(status));
  },
);

router.post(
  "/rooms/:roomCode/recommendations/reroll",
  async (req, res): Promise<void> => {
    const params = RerollRecommendationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(errorResponse(params.error.message));
      return;
    }
    const body = RerollRecommendationsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(errorResponse(body.error.message));
      return;
    }

    const roomCode = params.data.roomCode.toUpperCase();
    const outcome = await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(duoxingRoomsTable)
        .where(eq(duoxingRoomsTable.code, roomCode))
        .for("update")
        .limit(1);
      if (!room || room.expiresAt <= new Date()) return "not_found";

      const participants = await tx
        .select()
        .from(duoxingParticipantsTable)
        .where(eq(duoxingParticipantsTable.roomCode, roomCode));
      if (!participants.some((entry) => entry.id === body.data.participantId)) {
        return "not_found";
      }
      if (
        participants.length !== ROOM_SIZE ||
        participants.some((entry) => entry.submittedAt === null)
      ) {
        return "not_ready";
      }
      const saved = await tx.select().from(duoxingPreferencesTable)
        .where(inArray(duoxingPreferencesTable.participantId, participants.map(p => p.id)));
      if (saved.length !== participants.length || saved.some(p =>
        !SubmitPreferencesBody.safeParse({ ...p, preferenceRevision: room.round }).success)) return "not_ready";
      if (!getRecommendations(saved, room.recommendationPage).hasMoreRecommendations) return "exhausted";

      await tx
        .update(duoxingRoomsTable)
        .set({ recommendationPage: room.recommendationPage + 1 })
        .where(eq(duoxingRoomsTable.code, roomCode));
      return "rerolled";
    });

    if (outcome === "not_found") {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }
    if (outcome === "not_ready") {
      res.status(409).json(errorResponse("双方完成选择后才能更换推荐。"));
      return;
    }
    if (outcome === "exhausted") {
      res.status(409).json(errorResponse("暂时没有更多符合条件的推荐。"));
      return;
    }

    const status = await getParticipantStatus(
      roomCode,
      body.data.participantId,
    );
    if (!status) {
      res.status(404).json(errorResponse("房间或参与者不存在，或房间已过期。"));
      return;
    }
    res.json(status);
  },
);

export default router;
