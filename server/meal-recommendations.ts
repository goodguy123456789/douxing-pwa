import { rankCandidates, recommendationBatch, type MatchParticipant, type MatchRestaurant } from "./match-engine.ts";

export const restaurants: MatchRestaurant[] = [
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
export function getRecommendations(participants: MatchParticipant[], page = 0) {
  const ranked = rankCandidates(participants, restaurants);
  return {
    recommendations: recommendationBatch(ranked, page),
    hasMoreRecommendations: (page + 1) * 3 < ranked.length,
    candidateCount: ranked.length,
  };
}
