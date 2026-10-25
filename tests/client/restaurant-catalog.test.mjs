import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restaurantDirectory,candidatesForArea,getRealRecommendations} from '../../server/real-restaurants.ts';
import {restaurantMapUrl} from '../../shared/meal-areas.ts';
test('四个片区有独立分店与完整可追溯资料，快照修改不影响目录',()=>{
 const ids=new Set();for(const area of ['nanping','danzishi','chayuan','cqupt']){
 const rows=candidatesForArea(area);assert.ok(rows.length>=5);
 for(const row of rows){assert.equal(row.areaId,area);assert.ok(!ids.has(row.id));ids.add(row.id);assert.match(row.address,/重庆市南岸区/);assert.ok(new URL(row.sourceUrl).hostname);assert.match(row.checkedAt,/^\d{4}-\d{2}-\d{2}$/);assert.ok(['中餐','火锅','日料','韩餐','西餐','东南亚','烧烤','小吃','咖啡 / 甜品'].includes(row.cuisine));if(row.averagePrice!==null){assert.ok(row.averagePrice>0);assert.ok(new URL(row.priceSource).hostname);}}
 const original=rows[0].name;rows[0].name='被修改的副本';assert.equal(candidatesForArea(area)[0].name,original);
 }
 assert.equal(ids.size,restaurantDirectory.length);
});
test('地图关键词完整保留中文、分店、特殊符号与地址',()=>{
 const url=new URL(restaurantMapUrl('店名 A&B（重邮店）','重庆市南岸区崇文路1号附121号'));
 assert.equal(url.origin,'https://uri.amap.com');assert.equal(url.searchParams.get('keyword'),'店名 A&B（重邮店） 重庆市南岸区崇文路1号附121号');assert.equal(url.searchParams.get('city'),'重庆');assert.equal(url.searchParams.get('callnative'),'1');
 const fallback=new URL(restaurantMapUrl('店名 A&B（重邮店）','重庆市南岸区崇文路1号附121号',false));
 assert.equal(fallback.searchParams.get('callnative'),'0');assert.equal(fallback.searchParams.get('keyword'),url.searchParams.get('keyword'));
});
test('真实门店仍尊重菜系否决，不回退到样例或放宽未知价格',()=>{
 const person={budget:'unlimited',distance:'unlimited',spice:'any',cuisinePreferences:['中餐','火锅','日料','韩餐','西餐','东南亚','烧烤','小吃','咖啡 / 甜品'].map(cuisine=>({cuisine,attitude:'avoid'}))};
 assert.equal(getRealRecommendations([person,person],candidatesForArea('nanping')).candidateCount,0);
});

test('四区50元预算至少有三家已核实参考人均的候选，且反馈来源完整',()=>{
 const person={budget:'1',distance:'unlimited',spice:'any',cuisinePreferences:[]};
 for(const area of ['nanping','danzishi','chayuan','cqupt']){
  const rows=candidatesForArea(area);const result=getRealRecommendations([person,person],rows);
  assert.ok(result.candidateCount>=3,area+' 缺少50元内候选');
  for(const row of result.recommendations){assert.ok(row.averagePrice>0&&row.averagePrice<=50);assert.ok(row.feedback?.length, row.name+' 缺少来源反馈');}
  for(const row of rows)for(const item of row.feedback??[]){assert.ok(new URL(item.sourceUrl).hostname);assert.ok(item.sourceLabel);assert.ok(item.summary);assert.match(item.checkedAt,/^\d{4}-\d{2}-\d{2}$/);if(item.rating!=null)assert.ok(item.rating>=0&&item.rating<=5);}
 }
});
