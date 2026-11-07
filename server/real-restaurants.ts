import type { RestaurantFeedback } from '../shared/restaurant-feedback.ts';
import directory from './restaurant-directory.json' with {type:'json'};
import { rankCandidates,recommendationBatch,type MatchParticipant } from './match-engine.ts';
import type { MealAreaId } from '../shared/meal-areas.ts';
export type CatalogRestaurant = {
 id:string; areaId:MealAreaId; name:string; address:string; cuisine:string;
 averagePrice:number|null; priceSource:string|null; sourceUrl:string; checkedAt:string;
 spicyLevel:number|null; spiceAdjustable?:boolean; feedback?:RestaurantFeedback[];
};
export const CATALOG_VERSION='nanan-2026-10-25-v2';
export const restaurantDirectory=directory as CatalogRestaurant[];
export const candidatesForArea=(areaId:MealAreaId)=>structuredClone(restaurantDirectory.filter(r=>r.areaId===areaId));
export function getRealRecommendations(participants:MatchParticipant[],candidates:CatalogRestaurant[],page=0){
 const normalized=participants.map(p=>({...p,distance:'unlimited'}));
 const ranked=rankCandidates(normalized,candidates.map(r=>({...r,priceLevel:r.averagePrice===null?null:r.averagePrice<=50?1:r.averagePrice<=100?2:3,distance:null})))
 .map(r=>({...r,reasons:[...r.reasons,...(r.averagePrice===null?['人均暂无可靠资料，仅在预算不限时参与']:[])]}));
 return {recommendations:recommendationBatch(ranked,page),hasMoreRecommendations:(page+1)*3<ranked.length,candidateCount:ranked.length};
}
