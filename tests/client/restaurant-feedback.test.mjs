import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GetRoomResponse,SubmitPreferencesResponse,ResetRoomResponse,RerollRecommendationsResponse} from '../../shared/api-zod/generated/api.ts';
const feedback=[{sourceLabel:'大众点评',sourceUrl:'https://example.com/reviews',checkedAt:'2026-10-25',summary:'有食客喜欢份量。',caution:'有食客提醒饭点等餐。',spiceNote:'辣度仍待确认。',rating:4.1,reviewCount:45}];
const recommendation={name:'独立测试餐厅',cuisine:'中餐',priceLevel:1,distance:null,spicyLevel:null,matchScore:90,reasons:[],feedback};
const room={roomCode:'TEST1',expiresAt:new Date().toISOString(),participantId:'a',participantCount:2,submittedCount:2,requiredParticipantCount:2,hasSubmitted:true,ownDraft:null,preferenceRevision:1,algorithmVersion:'test',hasMoreRecommendations:false,candidateCount:1,state:'revealed',recommendations:[recommendation]};
test('读取、提交、重选与换组的响应保留评价来源，旧快照无需评价字段',()=>{
 for(const schema of [GetRoomResponse,SubmitPreferencesResponse,ResetRoomResponse,RerollRecommendationsResponse]){
  assert.deepEqual(schema.parse(room).recommendations[0].feedback,feedback);
  const old=structuredClone(room);delete old.recommendations[0].feedback;assert.equal(schema.parse(old).recommendations[0].feedback,undefined);
 }
});
