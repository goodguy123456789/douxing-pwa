import type {
  CuisineAttitude,
  PreferenceSubmission,
  RestaurantRecommendation,
} from "@workspace/api-zod";
import type { SavedCuisinePreference } from "@workspace/db";

type ParticipantPreferences = {
  budget: PreferenceSubmission["budget"];
  distance: PreferenceSubmission["distance"];
  cuisinePreferences: SavedCuisinePreference[];
  spice: PreferenceSubmission["spice"];
};

type Restaurant = Omit<RestaurantRecommendation, "matchPercent" | "reasons">;

const restaurants: Restaurant[] = [
  { name: "山海小馆", cuisine: "中餐", priceLevel: 2, distance: 1.2, spicyLevel: 1 },
  { name: "巷口川味", cuisine: "中餐", priceLevel: 1, distance: 2.7, spicyLevel: 2 },
  { name: "灶边家常菜", cuisine: "中餐", priceLevel: 1, distance: 0.8, spicyLevel: 0 },
  { name: "一锅热气", cuisine: "火锅", priceLevel: 2, distance: 2.1, spicyLevel: 2 },
  { name: "沸点小火锅", cuisine: "火锅", priceLevel: 1, distance: 1.4, spicyLevel: 1 },
  { name: "月见寿司", cuisine: "日料", priceLevel: 2, distance: 1.1, spicyLevel: 0 },
  { name: "白熊食堂", cuisine: "日料", priceLevel: 1, distance: 2.4, spicyLevel: 1 },
  { name: "鱼町居酒屋", cuisine: "日料", priceLevel: 3, distance: 4.1, spicyLevel: 2 },
  { name: "首尔小桌", cuisine: "韩餐", priceLevel: 2, distance: 2.2, spicyLevel: 2 },
  { name: "泡菜研究所", cuisine: "韩餐", priceLevel: 1, distance: 3.4, spicyLevel: 1 },
  { name: "黄油与胡椒", cuisine: "西餐", priceLevel: 3, distance: 3.7, spicyLevel: 1 },
  { name: "周五汉堡", cuisine: "西餐", priceLevel: 2, distance: 1.8, spicyLevel: 1 },
  { name: "小岛饭桌", cuisine: "东南亚", priceLevel: 2, distance: 2.9, spicyLevel: 2 },
  { name: "椰香巷", cuisine: "东南亚", priceLevel: 1, distance: 4.6, spicyLevel: 1 },
  { name: "炭火正好", cuisine: "烧烤", priceLevel: 2, distance: 1.9, spicyLevel: 2 },
  { name: "夜风烤串", cuisine: "烧烤", priceLevel: 1, distance: 3.2, spicyLevel: 1 },
  { name: "街角馄饨铺", cuisine: "小吃", priceLevel: 1, distance: 0.6, spicyLevel: 0 },
  { name: "一口满足", cuisine: "小吃", priceLevel: 1, distance: 2.8, spicyLevel: 1 },
  { name: "酥酥葱油饼", cuisine: "小吃", priceLevel: 1, distance: 1.3, spicyLevel: 0 },
  { name: "慢半拍咖啡", cuisine: "咖啡 / 甜品", priceLevel: 2, distance: 1.7, spicyLevel: 0 },
  { name: "糖水小日子", cuisine: "咖啡 / 甜品", priceLevel: 1, distance: 2.5, spicyLevel: 0 },
  { name: "奶油云朵", cuisine: "咖啡 / 甜品", priceLevel: 2, distance: 4.3, spicyLevel: 0 },
  { name: "锅气食堂", cuisine: "中餐", priceLevel: 2, distance: 3.8, spicyLevel: 1 },
  { name: "海风饭团", cuisine: "日料", priceLevel: 1, distance: 0.9, spicyLevel: 0 },
];

function numericLimit(value: string, unrestricted: number): number {
  return value === "unlimited" ? unrestricted : Number(value);
}

function attitudeFor(
  participant: ParticipantPreferences,
  cuisine: string,
): CuisineAttitude | undefined {
  return participant.cuisinePreferences.find((entry) => entry.cuisine === cuisine)
    ?.attitude as CuisineAttitude | undefined;
}

function spiceCompatible(
  preference: ParticipantPreferences["spice"],
  restaurantLevel: number,
): boolean {
  if (preference === "any") return true;
  if (preference === "none") return restaurantLevel === 0;
  return restaurantLevel <= 1;
}

export function rankRestaurants(
  participants: ParticipantPreferences[],
  recommendationPage = 0,
): RestaurantRecommendation[] {
  if (participants.length === 0) return [];

  const budgetLimit = Math.min(
    ...participants.map((participant) => numericLimit(participant.budget, 3)),
  );
  const distanceLimit = Math.min(
    ...participants.map((participant) => numericLimit(participant.distance, 10)),
  );

  const ranked = restaurants
    .map((restaurant) => {
      const attitudes = participants.map((participant) =>
        attitudeFor(participant, restaurant.cuisine),
      );
      if (attitudes.includes("avoid")) return null;

      const cuisinePoints = attitudes.reduce((total, attitude) => {
        if (attitude === "love") return total + 2;
        if (attitude === "okay") return total + 1;
        return total;
      }, 0);
      const maxCuisinePoints = participants.length * 2;
      const budgetFits = restaurant.priceLevel <= budgetLimit;
      const distanceFits = restaurant.distance <= distanceLimit;
      const spiceFits = participants.every((participant) =>
        spiceCompatible(participant.spice, restaurant.spicyLevel),
      );

      const matchPercent = Math.round(
        (cuisinePoints / maxCuisinePoints) * 60 +
          (budgetFits ? 15 : 0) +
          (distanceFits ? 15 : 0) +
          (spiceFits ? 10 : 0),
      );
      const loveCount = attitudes.filter((attitude) => attitude === "love").length;
      const acceptingCount = attitudes.filter(
        (attitude) => attitude === "love" || attitude === "okay",
      ).length;

      const reasons = [
        acceptingCount === participants.length
          ? `你们都能接受${restaurant.cuisine}`
          : acceptingCount > 0
            ? `${acceptingCount} 人选择接受或喜欢${restaurant.cuisine}`
            : `没人否决${restaurant.cuisine}`,
        ...(loveCount > 0 ? [`其中 ${loveCount} 人很想吃`] : []),
        budgetFits ? "符合双方预算" : "超出双方中较低的预算",
        distanceFits ? "符合双方距离要求" : "超出双方中较短的距离范围",
        spiceFits ? "辣度偏好相容" : "辣度和至少一人的偏好不完全一致",
      ];

      return {
        ...restaurant,
        matchPercent,
        reasons,
        cuisinePoints,
        budgetFits,
        distanceFits,
        spiceFits,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (a, b) =>
        b.cuisinePoints - a.cuisinePoints ||
        Number(b.budgetFits) - Number(a.budgetFits) ||
        Number(b.distanceFits) - Number(a.distanceFits) ||
        Number(b.spiceFits) - Number(a.spiceFits) ||
        b.matchPercent - a.matchPercent ||
        a.name.localeCompare(b.name, "zh-CN"),
    );

  const pageCount = Math.max(1, Math.ceil(ranked.length / 3));
  const currentPage =
    Math.max(0, Math.floor(recommendationPage)) % pageCount;
  const selected = ranked.slice(currentPage * 3, currentPage * 3 + 3);

  return selected.map(
    ({ cuisinePoints: _cuisinePoints, budgetFits: _budgetFits, distanceFits: _distanceFits, spiceFits: _spiceFits, ...recommendation }) =>
      recommendation,
  );
}
