/** Authoritative, deterministic matching rules. No database or UI dependencies. */
export const ALGORITHM_VERSION = "fair-match-2";
export const MATCH_WEIGHTS = { cuisine: 0.3, fairness: 0.3, budget: 0.15, distance: 0.15, spicy: 0.1 } as const;
export type MatchParticipant = {
  budget: string;
  distance: string;
  spice: string;
  cuisinePreferences: { cuisine: string; attitude: string }[];
};
export type MatchRestaurant = {
  name: string;
  cuisine: string;
  priceLevel: number | null;
  distance: number | null;
  spicyLevel: number | null;
  /** Only supplied when the example data explicitly guarantees adjustability. */
  spiceAdjustable?: boolean;
};

export function minimumFiniteLimit(values: (number | "unlimited")[]): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.min(...finite) : null;
}
export function effectiveLimits(participants: MatchParticipant[]) {
  const limit = (value: string) => value === "unlimited" ? "unlimited" as const : Number(value);
  return {
    budget: minimumFiniteLimit(participants.map(p => limit(p.budget))),
    distance: minimumFiniteLimit(participants.map(p => limit(p.distance))),
  };
}
function attitude(p: MatchParticipant, cuisine: string) {
  return p.cuisinePreferences.find(item => item.cuisine === cuisine)?.attitude;
}
/** Hard veto and known incompatibilities are checked BEFORE scoring. */
export function isEligible(participants: MatchParticipant[], restaurant: MatchRestaurant): boolean {
  if (participants.length < 2) return false;
  if (participants.some(p => p.cuisinePreferences.some(item => item.cuisine === restaurant.cuisine && item.attitude === "avoid"))) return false;
  const limits = effectiveLimits(participants);
  if (limits.budget !== null && (restaurant.priceLevel === null || restaurant.priceLevel > limits.budget)) return false;
  if (limits.distance !== null && (restaurant.distance === null || restaurant.distance > limits.distance)) return false;
  if (restaurant.spiceAdjustable === false && participants.some(p =>
    p.spice !== "any" && restaurant.spicyLevel !== null && restaurant.spicyLevel > (p.spice === "none" ? 0 : 1))) return false;
  return true;
}
export function calculateMatch<T extends MatchRestaurant>(participants: MatchParticipant[], restaurant: T) {
  if (!isEligible(participants, restaurant)) return null;
  const attitudes = participants.map(p => attitude(p, restaurant.cuisine));
  const personal = attitudes.map(value => value === "love" ? 1 : value === "okay" ? 0.5 : 0);
  const minimumSatisfaction = Math.min(...personal);
  const averageSatisfaction = personal.reduce<number>((a, b) => a + b, 0) / personal.length;
  const agreement = 1 - (Math.max(...personal) - minimumSatisfaction);
  const knownSpice = restaurant.spiceAdjustable !== undefined;
  const dimensions = {
    cuisine: averageSatisfaction,
    fairness: minimumSatisfaction * agreement,
    // Example-only attributes are eligibility constraints, not evidence of satisfaction.
    // Setting a limit must never earn points compared with leaving it unrestricted.
    budget: 0.5,
    distance: 0.5,
    spicy: knownSpice
      ? participants.reduce((sum, p) => sum + (p.spice === "any" ? 0.5 : 1), 0) / participants.length
      : 0.5,
  };
  const score = Math.round(100 * (Object.keys(MATCH_WEIGHTS) as (keyof typeof MATCH_WEIGHTS)[])
    .reduce((sum, key) => sum + dimensions[key] * MATCH_WEIGHTS[key], 0));
  const reasons: string[] = [];
  if (attitudes.every(a => a === "love")) reasons.push(`你们都喜欢${restaurant.cuisine}`);
  else if (attitudes.every(a => a === "love" || a === "okay")) {
    reasons.push(attitudes.some(a => a === "love")
      ? "有人很想吃，其他人也能接受" : "大家都能接受这个选择");
  } else reasons.push(`没有人明确否决${restaurant.cuisine}，但部分人尚未表达接受意愿`);
  const limits = effectiveLimits(participants);
  if (limits.budget !== null) reasons.push("在大家的预算等级范围内");
  if (limits.distance !== null) reasons.push("符合大家的示例距离要求");
  if (knownSpice && participants.some(p => p.spice !== "any")) reasons.push("符合大家的辣度偏好");
  if (!knownSpice) reasons.push("辣度可调整性未知，未认定完全兼容");
  return { ...restaurant, matchScore: score, reasons, dimensions, minimumSatisfaction, averageSatisfaction };
}
export function rankCandidates<T extends MatchRestaurant>(participants: MatchParticipant[], restaurants: T[]) {
  return restaurants.map(r => calculateMatch(participants, r))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.minimumSatisfaction - a.minimumSatisfaction
      || b.averageSatisfaction - a.averageSatisfaction
      || b.matchScore - a.matchScore
      || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export function recommendationBatch<T>(ranked: T[], page = 0) {
  return ranked.slice(Math.max(0, Math.floor(page)) * 3, Math.max(0, Math.floor(page)) * 3 + 3);
}
