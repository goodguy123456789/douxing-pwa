import test from "node:test";
import assert from "node:assert/strict";
import { calculateMatch, effectiveLimits, minimumFiniteLimit, rankCandidates, recommendationBatch, MATCH_WEIGHTS, type MatchParticipant, type MatchRestaurant } from "../src/lib/match-engine";
import { restaurants, getRecommendations } from "../src/lib/meal-recommendations";
const p = (attitude?: string, cuisine = "日料", overrides: Partial<MatchParticipant> = {}): MatchParticipant =>
  ({ budget: "unlimited", distance: "unlimited", spice: "any", cuisinePreferences: attitude ? [{ cuisine, attitude }] : [], ...overrides });
const r: MatchRestaurant = { name: "测试日料", cuisine: "日料", priceLevel: 2, distance: 2, spicyLevel: 0 };
const score = (ps: MatchParticipant[]) => calculateMatch(ps, r)!;
test("01 both love gives highest cuisine score", () => assert.equal(score([p("love"), p("love")]).dimensions.cuisine, 1));
test("02 love and okay stays eligible", () => assert.ok(calculateMatch([p("love", "火锅"), p("okay", "火锅")], { ...r, cuisine: "火锅" })));
test("03 any veto excludes barbecue before scoring", () => assert.equal(calculateMatch([p("love", "烧烤"), p("avoid", "烧烤")], { ...r, cuisine: "烧烤" }), null));
test("04 unselected is neutral, not veto or acceptance", () => { assert.ok(score([p(), p()])); assert.equal(score([p(), p()]).dimensions.cuisine, 0); });
test("05 stricter budget level excludes expensive candidate", () => assert.equal(calculateMatch([p(undefined, "", { budget: "3" }), p(undefined, "", { budget: "1" })], r), null));
test("06 stricter distance is a hard filter", () => assert.equal(calculateMatch([p(undefined, "", { distance: "5" }), p(undefined, "", { distance: "1" })], r), null));
test("07 all cuisines vetoed returns no candidates", () => { const veto = p(); veto.cuisinePreferences = [...new Set(restaurants.map(r => r.cuisine))].map(cuisine => ({ cuisine, attitude: "avoid" })); assert.deepEqual(rankCandidates([p(), veto], restaurants), []); });
test("08 identical input returns identical scores and order", () => assert.deepEqual(rankCandidates([p("love"), p()], restaurants), rankCandidates([p("love"), p()], restaurants)));
test("09 both okay outranks love plus unselected", () => {
  const ps = [p("love", "中餐"), p()];
  ps.forEach(x => x.cuisinePreferences.push({ cuisine: "日料", attitude: "okay" }));
  const ranking = rankCandidates(ps, [r, { ...r, name: "中餐", cuisine: "中餐" }]);
  assert.equal(ranking[0].cuisine, "日料");
  assert.ok(score([p("okay"), p("okay")]).matchScore > score([p("love"), p()]).matchScore);
});
test("10 rotating candidates does not mutate preferences", () => { const ps = [p("love"), p()]; const before = structuredClone(ps); getRecommendations(ps, 1); assert.deepEqual(ps, before); });
test("14 third participant veto also excludes cuisine", () => assert.equal(calculateMatch([p("love"), p("okay"), p("avoid")], r), null));
test("15 three budgets 100/80/50 reduce to 50; levels 3/2/1 reduce to 1", () => { assert.equal(minimumFiniteLimit([100, 80, 50]), 50); assert.equal(effectiveLimits(["3", "2", "1"].map(budget => p(undefined, "", { budget }))).budget, 1); });
test("16 three people all love receive reasonable high score", () => assert.ok(score([p("love"), p("love"), p("love")]).matchScore >= 80));
test("17 same restaurant score unaffected by recommendation page", () => {
  const ps = [p("love"), p("okay")]; const ranked = rankCandidates(ps, restaurants);
  for (let page = 0; page < 9; page++) for (const item of getRecommendations(ps, page).recommendations)
    assert.equal(item.matchScore, ranked.find(x => x.name === item.name)!.matchScore);
});
test("18 scores bounded for exhaustive two-person attitudes", () => { for (const a of [undefined, "love", "okay", "avoid"]) for (const b of [undefined, "love", "okay", "avoid"]) { const result = calculateMatch([p(a), p(b)], r); if (result) assert.ok(result.matchScore >= 0 && result.matchScore <= 100); } });
test("19 reasons agree with actual preferences", () => { assert.match(score([p("love"), p("love")]).reasons[0], /都喜欢/); assert.equal(score([p("okay"), p("okay")]).reasons[0], "大家都能接受这个选择"); assert.match(score([p("love"), p()]).reasons[0], /尚未表达/); });
test("20 impossible constraints return no fake recommendations", () => assert.deepEqual(rankCandidates([p(undefined, "", { distance: "0.1" }), p()], restaurants), []));
test("unlimited imposes no artificial budget or distance ceiling", () => { assert.deepEqual(effectiveLimits([p(), p()]), { budget: null, distance: null }); assert.ok(calculateMatch([p(), p()], { ...r, distance: 999 })); });
test("unknown spice is neutral and never claims compatibility", () => { const result = score([p(undefined, "", { spice: "none" }), p()]); assert.equal(result.dimensions.spicy, 0.5); assert.ok(!result.reasons.includes("符合大家的辣度偏好")); });
test("known non-adjustable hot option excluded for no-spice user", () => assert.equal(calculateMatch([p(undefined, "", { spice: "none" }), p()], { ...r, spicyLevel: 2, spiceAdjustable: false }), null));
test("exhausted pages stay empty instead of wrapping", () => { assert.deepEqual(recommendationBatch([1, 2, 3], 1), []); assert.equal(getRecommendations([p(), p()], 100).hasMoreRecommendations, false); });
test("weights sum to one and formula matches rounded weighted dimensions", () => { assert.equal(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0), 1); const result = score([p("love"), p("okay")]); assert.equal(result.matchScore, Math.round(100 * Object.entries(MATCH_WEIGHTS).reduce((sum, [key, weight]) => sum + result.dimensions[key as keyof typeof MATCH_WEIGHTS] * weight, 0))); });
test("one participant cannot calculate a final match", () => assert.equal(calculateMatch([p("love")], r), null));
test("sparse preferences cannot generate unjustified high scores", () => assert.ok(score([p(), p()]).matchScore <= 20));
test("N=8 needs no algorithm changes", () => assert.ok(calculateMatch(Array.from({ length: 8 }, () => p("okay")), r)));
