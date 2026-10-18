import test from "node:test";
import assert from "node:assert/strict";
const base = "http://localhost:80/api";
async function request(path, method = "GET", body) {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const preferences = (id, revision = 1, overrides = {}) => ({ participantId: id, preferenceRevision: revision, budget: "unlimited", distance: "unlimited", spice: "any", cuisinePreferences: [], ...overrides });
async function setup() {
  const { data: a } = await request("/rooms", "POST", {});
  const { data: b } = await request(`/rooms/${a.roomCode}/join`, "POST", {});
  const path = `/rooms/${a.roomCode}`;
  const submit = (id, revision = 1, extra = {}) => request(path + "/preferences", "PUT", preferences(id, revision, extra));
  const get = id => request(path + "/participants/" + id);
  return { a, b, path, submit, get };
}
test("12 only 1/2 submitted: no final results from server", async () => { const { a, submit } = await setup(); const { data } = await submit(a.participantId); assert.equal(data.submittedCount, 1); assert.notEqual(data.state, "revealed"); assert.deepEqual(data.recommendations, []); });
test("13 2/2 valid submissions: both participants get same final results", async () => { const { a, b, submit, get } = await setup(); await submit(a.participantId); const { data } = await submit(b.participantId); assert.equal(data.state, "revealed"); assert.equal(data.submittedCount, 2); assert.deepEqual((await get(a.participantId)).data.recommendations, data.recommendations); });
test("11 resubmitting invalidates old results and requires fresh partner submission", async () => { const { a, b, submit, get } = await setup(); await submit(a.participantId); await submit(b.participantId); const { data } = await submit(a.participantId, 1, { budget: "1" }); assert.equal(data.preferenceRevision, 2); assert.equal(data.submittedCount, 1); assert.deepEqual(data.recommendations, []); assert.equal((await get(b.participantId)).data.hasSubmitted, false); assert.equal((await submit(b.participantId, 1)).status, 400); assert.equal((await submit(b.participantId, 2)).data.state, "revealed"); });
test("10 and 17 reroll keeps participants, revision and restaurant scores; exhaustion rejects without wrapping", async () => { const { a, b, path, submit, get } = await setup(); await submit(a.participantId); let current = (await submit(b.participantId)).data; const seen = new Map(); while (true) { for (const item of current.recommendations) { assert.ok(!seen.has(item.name)); seen.set(item.name, item.matchScore); } if (!current.hasMoreRecommendations) break; current = (await request(path + "/recommendations/reroll", "POST", { participantId: a.participantId })).data; assert.equal(current.submittedCount, 2); assert.equal(current.preferenceRevision, 1); } assert.equal(seen.size, current.candidateCount); assert.equal((await request(path + "/recommendations/reroll", "POST", { participantId: a.participantId })).status, 409); assert.deepEqual((await get(b.participantId)).data.recommendations, current.recommendations); });
test("reset increments revision and removes both submissions", async () => { const { a, b, path, submit } = await setup(); await submit(a.participantId); await submit(b.participantId); const { data } = await request(path + "/reset", "POST", { participantId: a.participantId }); assert.equal(data.preferenceRevision, 2); assert.equal(data.submittedCount, 0); assert.deepEqual(data.recommendations, []); assert.equal((await submit(a.participantId, 1)).status, 400); });
test("hard-filtered empty result is real and room still rejects a third person", async () => { const { a, b, path, submit } = await setup(); const cuisinePreferences = ["中餐", "火锅", "日料", "韩餐", "西餐", "东南亚", "烧烤", "小吃", "咖啡 / 甜品"].map(cuisine => ({ cuisine, attitude: "avoid" })); await submit(a.participantId, 1, { cuisinePreferences }); const { data } = await submit(b.participantId); assert.equal(data.state, "revealed"); assert.equal(data.candidateCount, 0); assert.deepEqual(data.recommendations, []); assert.equal((await request(path + "/join", "POST", {})).status, 409); });
test("invalid or duplicate preferences do not count as submissions", async () => { const { a, submit, get } = await setup(); assert.equal((await submit(a.participantId, 1, { budget: "bad" })).status, 400); assert.equal((await submit(a.participantId, 1, { cuisinePreferences: [{ cuisine: "日料", attitude: "love" }, { cuisine: "日料", attitude: "avoid" }] })).status, 400); assert.equal((await get(a.participantId)).data.submittedCount, 0); });
test("legacy page without revision receives human refresh guidance instead of Zod issues", async () => {
  const { a, path, get } = await setup();
  const payload = preferences(a.participantId); delete payload.preferenceRevision;
  const response = await request(path + "/preferences", "PUT", payload);
  assert.equal(response.status, 400); assert.match(response.data.error, /刷新页面/); assert.match(response.data.error, /尚未保存/);
  assert.doesNotMatch(response.data.error, /invalid_type|expected|preferenceRevision/);
  assert.equal((await get(a.participantId)).data.submittedCount, 0);
});
test("invalid revision type also returns refresh guidance", async () => {
  const { a, submit } = await setup(); const response = await submit(a.participantId, "old");
  assert.equal(response.status, 400); assert.match(response.data.error, /刷新页面/);
});
test("stale revision after partner resets cannot save preferences or reveal stale results", async () => {
  const { a, b, path, submit, get } = await setup();
  await submit(a.participantId); await submit(b.participantId);
  await request(path + "/reset", "POST", { participantId: b.participantId });
  const response = await submit(a.participantId, 1);
  assert.equal(response.status, 400); assert.match(response.data.error, /刷新页面/);
  const current = (await get(a.participantId)).data;
  assert.equal(current.preferenceRevision, 2); assert.equal(current.submittedCount, 0); assert.deepEqual(current.recommendations, []);
});
test("reset keeps distinct private drafts, survives reload reads and needs both current confirmations", async () => {
  const { a, b, path, submit, get } = await setup();
  const first = { nickname: "甲", budget: "2", distance: "3", spice: "mild", cuisinePreferences: [{ cuisine: "日料", attitude: "love" }, { cuisine: "火锅", attitude: "avoid" }] };
  const second = { nickname: "乙", budget: "3", distance: "5", spice: "none", cuisinePreferences: [{ cuisine: "中餐", attitude: "okay" }] };
  assert.equal((await get(a.participantId)).data.ownDraft, null);
  await submit(a.participantId, 1, first);
  assert.equal((await get(b.participantId)).data.ownDraft, null);
  await submit(b.participantId, 1, second);
  const reset = await request(path + "/reset", "POST", { participantId: a.participantId });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.data.ownDraft, first);
  for (const [id, draft] of [[a.participantId, first], [b.participantId, second]]) {
    // Independent reads model refresh recovery and the partner's poll.
    for (let i = 0; i < 2; i++) {
      const { data } = await get(id);
      assert.deepEqual(data.ownDraft, draft);
      assert.equal(data.preferenceRevision, 2);
      assert.equal(data.hasSubmitted, false);
      assert.equal(data.submittedCount, 0);
      assert.equal(data.state, "choosing");
      assert.equal(data.candidateCount, 0);
      assert.equal(data.hasMoreRecommendations, false);
      assert.deepEqual(data.recommendations, []);
    }
  }
  assert.equal((await request(path + "/recommendations/reroll", "POST", { participantId: a.participantId })).status, 409);
  assert.equal((await submit(a.participantId, 1, { ...first, budget: "1" })).status, 400);
  assert.deepEqual((await get(a.participantId)).data.ownDraft, first);
  const edited = { ...first, budget: "unlimited", cuisinePreferences: [] };
  assert.equal((await submit(a.participantId, 2, edited)).data.submittedCount, 1);
  const partner = (await get(b.participantId)).data;
  assert.equal(partner.hasSubmitted, false);
  assert.deepEqual(partner.ownDraft, second);
  assert.deepEqual(partner.recommendations, []);
  assert.equal((await submit(b.participantId, 2, second)).data.state, "revealed");
  assert.equal((await get(a.participantId)).data.state, "revealed");
  await request(path + "/reset", "POST", { participantId: b.participantId });
  assert.deepEqual((await get(a.participantId)).data.ownDraft, edited);
  assert.equal((await get(a.participantId)).data.preferenceRevision, 3);
});
test("draft access requires a room-scoped secret participant ID and exposes no partner data", async () => {
  const { a, b, path, submit, get } = await setup();
  const { a: outsider } = await setup();
  await submit(a.participantId, 1, { nickname: "不公开的称呼", cuisinePreferences: [{ cuisine: "烧烤", attitude: "avoid" }] });
  const partner = (await get(b.participantId)).data;
  assert.equal(partner.ownDraft, null);
  assert.doesNotMatch(JSON.stringify(partner), new RegExp(`${a.participantId}|不公开的称呼|烧烤|avoid|updatedAt`));
  assert.equal((await get(outsider.participantId)).status, 404);
  assert.equal((await get("not-a-participant")).status, 404);
  const response = await fetch(base + path + "/participants/" + a.participantId);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys((await response.json()).ownDraft).sort(), ["budget", "cuisinePreferences", "distance", "nickname", "spice"]);
});
test("resubmission preserves the partner draft without preserving their confirmation", async () => {
  const { a, b, submit, get } = await setup();
  await submit(a.participantId);
  await submit(b.participantId, 1, { budget: "2", spice: "none" });
  const draft = (await get(b.participantId)).data.ownDraft;
  await submit(a.participantId, 1, { budget: "3" });
  const current = (await get(b.participantId)).data;
  assert.deepEqual(current.ownDraft, draft);
  assert.equal(current.hasSubmitted, false);
  assert.equal(current.preferenceRevision, 2);
});

// Start every operation in the same turn, without sleeps or assuming which
// connection acquires the room lock first. Reverse launch order across runs.
const raceAttempts = 6;
function concurrently(operations, attempt) {
  const ordered = operations.map((operation, index) => ({ operation, index }));
  if (attempt % 2) ordered.reverse();
  return Promise.all(ordered.map(async ({ operation, index }) => ({
    index, response: await operation(),
  }))).then(results => results.sort((a, b) => a.index - b.index).map(result => result.response));
}
const raceDrafts = [
  { nickname: "并发甲的私有草稿", budget: "unlimited", distance: "unlimited", spice: "any", cuisinePreferences: [{ cuisine: "日料", attitude: "love" }] },
  { nickname: "并发乙的私有草稿", budget: "3", distance: "unlimited", spice: "any", cuisinePreferences: [{ cuisine: "烧烤", attitude: "love" }] },
];
function assertSnapshot(data, id, partnerId, draft, partnerDraft, revision, submittedCount, hasSubmitted) {
  assert.equal(data.participantId, id);
  assert.equal(data.participantCount, 2);
  assert.equal(data.requiredParticipantCount, 2);
  assert.equal(data.preferenceRevision, revision);
  assert.equal(data.submittedCount, submittedCount);
  assert.equal(data.hasSubmitted, hasSubmitted);
  assert.equal(data.state, submittedCount === 2 ? "revealed" : hasSubmitted ? "waiting_for_other" : "choosing");
  assert.deepEqual(data.ownDraft, draft);
  // Neither the partner's bearer credential nor their private nickname/draft
  // belongs in this participant's response.
  assert.ok(!JSON.stringify(data).includes(partnerId));
  assert.ok(!JSON.stringify(data).includes(partnerDraft.nickname));
  assert.deepEqual(Object.keys(data.ownDraft).sort(), ["budget", "cuisinePreferences", "distance", "nickname", "spice"]);
  if (submittedCount < 2) {
    assert.deepEqual(data.recommendations, []);
    assert.equal(data.candidateCount, 0);
    assert.equal(data.hasMoreRecommendations, false);
  }
}
async function assertBoth(room, revision, drafts, confirmed) {
  const ids = [room.a.participantId, room.b.participantId];
  const responses = await Promise.all(ids.map(id => room.get(id)));
  const count = confirmed.filter(Boolean).length;
  responses.forEach(({ status, data }, index) => {
    assert.equal(status, 200);
    assertSnapshot(data, ids[index], ids[1 - index], drafts[index], drafts[1 - index], revision, count, confirmed[index]);
  });
  const shared = data => ({
    roomCode: data.roomCode,
    preferenceRevision: data.preferenceRevision,
    submittedCount: data.submittedCount,
    participantCount: data.participantCount,
    algorithmVersion: data.algorithmVersion,
    recommendations: data.recommendations,
    candidateCount: data.candidateCount,
    hasMoreRecommendations: data.hasMoreRecommendations,
  });
  assert.deepEqual(shared(responses[0].data), shared(responses[1].data));
  return responses.map(response => response.data);
}
async function seedRaceRoom() {
  const room = await setup();
  assert.equal((await room.submit(room.a.participantId, 1, raceDrafts[0])).status, 200);
  const revealed = await room.submit(room.b.participantId, 1, raceDrafts[1]);
  assert.equal(revealed.status, 200);
  assert.equal(revealed.data.state, "revealed");
  assert.ok(revealed.data.recommendations.length > 0);
  return room;
}
async function assertStalePair(room, staleRevision, currentRevision, drafts, confirmed, attempt) {
  const responses = await concurrently([
    () => room.submit(room.a.participantId, staleRevision, { ...drafts[0], nickname: "不能保存的旧甲", budget: "1" }),
    () => room.submit(room.b.participantId, staleRevision, { ...drafts[1], nickname: "不能保存的旧乙", spice: "mild" }),
  ], attempt);
  for (const response of responses) {
    assert.equal(response.status, 400);
    assert.match(response.data.error, /刷新页面/);
  }
  await assertBoth(room, currentRevision, drafts, confirmed);
}

test("concurrent reset and submission follow either serial order without restoring the previous result", async t => {
  for (const alreadyConfirmed of [false, true]) {
    for (let attempt = 0; attempt < raceAttempts; attempt++) {
      await t.test(`${alreadyConfirmed ? "resubmit" : "first confirmation"}, run ${attempt + 1}`, async () => {
        const room = await seedRaceRoom();
        // Also exercise a first confirmation racing reset, not only resubmits.
        if (!alreadyConfirmed) {
          assert.equal((await request(room.path + "/reset", "POST", { participantId: room.a.participantId })).status, 200);
          assert.equal((await room.submit(room.a.participantId, 2, raceDrafts[0])).status, 200);
        }
        const revision = alreadyConfirmed ? 1 : 2;
        const edited = { ...raceDrafts[1], nickname: "并发乙更新后的草稿", budget: "2" };
        const [reset, submission] = await concurrently([
          () => request(room.path + "/reset", "POST", { participantId: room.a.participantId }),
          () => room.submit(room.b.participantId, revision, edited),
        ], attempt);
        assert.equal(reset.status, 200);
        assert.ok([200, 400].includes(submission.status));
        // Submit first: a resubmit advances once, then reset advances once.
        // Reset first: the old submit is rejected and cannot alter its draft.
        const nextRevision = revision + 1 + Number(alreadyConfirmed && submission.status === 200);
        const drafts = [raceDrafts[0], submission.status === 200 ? edited : raceDrafts[1]];
        assertSnapshot(reset.data, room.a.participantId, room.b.participantId, drafts[0], drafts[1], nextRevision, 0, false);
        if (submission.status === 200) {
          // Its post-commit snapshot may precede or follow reset.
          assert.ok([nextRevision - 1, nextRevision].includes(submission.data.preferenceRevision));
          const afterReset = submission.data.preferenceRevision === nextRevision;
          const count = afterReset ? 0 : alreadyConfirmed ? 1 : 2;
          assertSnapshot(submission.data, room.b.participantId, room.a.participantId, edited, drafts[0], submission.data.preferenceRevision, count, !afterReset);
        } else {
          assert.match(submission.data.error, /刷新页面/);
        }
        await assertBoth(room, nextRevision, drafts, [false, false]);
        await assertStalePair(room, revision, nextRevision, drafts, [false, false], attempt);
        // One current confirmation must still not reuse the partner's old vote.
        assert.equal((await room.submit(room.a.participantId, nextRevision, drafts[0])).status, 200);
        await assertBoth(room, nextRevision, drafts, [true, false]);
        assert.equal((await room.submit(room.b.participantId, nextRevision, drafts[1])).status, 200);
        await assertBoth(room, nextRevision, drafts, [true, true]);
      });
    }
  }
});

test("simultaneous confirmations reveal only the current round; simultaneous resubmits cannot count an old vote", async t => {
  for (let attempt = 0; attempt < raceAttempts; attempt++) {
    await t.test(`run ${attempt + 1}`, async () => {
      const room = await seedRaceRoom();
      assert.equal((await request(room.path + "/reset", "POST", { participantId: room.a.participantId })).status, 200);
      const drafts = raceDrafts.map((draft, index) => ({ ...draft, nickname: `新一轮私有草稿${index}`, budget: "2" }));
      const ids = [room.a.participantId, room.b.participantId];
      const confirmations = await concurrently(ids.map((id, index) => () => room.submit(id, 2, drafts[index])), attempt);
      confirmations.forEach((response, index) => {
        assert.equal(response.status, 200);
        // The read transaction can see its own confirmation or both, but never
        // the other round or a snapshot with neither confirmation.
        assert.ok([1, 2].includes(response.data.submittedCount));
        assertSnapshot(response.data, ids[index], ids[1 - index], drafts[index], drafts[1 - index], 2, response.data.submittedCount, true);
      });
      await assertBoth(room, 2, drafts, [true, true]);
      const edits = drafts.map((draft, index) => ({ ...draft, nickname: `再次修改私有草稿${index}`, budget: "1" }));
      const resubmissions = await concurrently(ids.map((id, index) => () => room.submit(id, 2, edits[index])), attempt);
      assert.deepEqual(resubmissions.map(response => response.status).sort(), [200, 400]);
      const winner = resubmissions.findIndex(response => response.status === 200);
      const currentDrafts = drafts.map((draft, index) => index === winner ? edits[index] : draft);
      const confirmed = ids.map((_, index) => index === winner);
      assertSnapshot(resubmissions[winner].data, ids[winner], ids[1 - winner], currentDrafts[winner], currentDrafts[1 - winner], 3, 1, true);
      assert.match(resubmissions[1 - winner].data.error, /刷新页面/);
      await assertBoth(room, 3, currentDrafts, confirmed);
      await assertStalePair(room, 2, 3, currentDrafts, confirmed, attempt);
      assert.equal((await room.submit(ids[1 - winner], 3, currentDrafts[1 - winner])).status, 200);
      await assertBoth(room, 3, currentDrafts, [true, true]);
    });
  }
});

test("duplicate concurrent resets each advance once and never retain previous confirmations", async t => {
  for (const sameParticipant of [true, false]) {
    for (let attempt = 0; attempt < raceAttempts; attempt++) {
      await t.test(`${sameParticipant ? "same participant" : "both participants"}, run ${attempt + 1}`, async () => {
        const room = await seedRaceRoom();
        const ids = [room.a.participantId, sameParticipant ? room.a.participantId : room.b.participantId];
        const resets = await concurrently(ids.map(id => () => request(room.path + "/reset", "POST", { participantId: id })), attempt);
        resets.forEach((response, index) => {
          assert.equal(response.status, 200);
          // Reset is intentionally not idempotent today. Two accepted requests
          // mean +2, while their later snapshot reads may both report round 3.
          assert.ok([2, 3].includes(response.data.preferenceRevision));
          const owner = ids[index] === room.a.participantId ? 0 : 1;
          assertSnapshot(response.data, ids[index], owner === 0 ? room.b.participantId : room.a.participantId, raceDrafts[owner], raceDrafts[1 - owner], response.data.preferenceRevision, 0, false);
        });
        await assertBoth(room, 3, raceDrafts, [false, false]);
        await assertStalePair(room, 1, 3, raceDrafts, [false, false], attempt);
        await assertStalePair(room, 2, 3, raceDrafts, [false, false], attempt);
        assert.equal((await request(room.path + "/recommendations/reroll", "POST", { participantId: room.a.participantId })).status, 409);
        assert.equal((await room.submit(room.a.participantId, 3, raceDrafts[0])).status, 200);
        await assertBoth(room, 3, raceDrafts, [true, false]);
        assert.equal((await room.submit(room.b.participantId, 3, raceDrafts[1])).status, 200);
        await assertBoth(room, 3, raceDrafts, [true, true]);
      });
    }
  }
});
