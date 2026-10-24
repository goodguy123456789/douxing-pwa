import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleApi, cleanupExpiredRooms } from '../server/api.ts';

let mf, db;
before(async () => {
  mf = new Miniflare({ modules:true, script:'export default {fetch(){return new Response("test")}}',
    compatibilityDate:'2026-05-15', d1Databases:['DB'], cf:false });
  db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE duoxing_rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX duoxing_rooms_expiry ON duoxing_rooms(expires_at, code)').run();
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => { await db.prepare('DELETE FROM duoxing_rooms').run(); });
const headers = {'X-Duoxing-Client':'restaurants-v1','X-Duoxing-Auth':'token-v1','Content-Type':'application/json'};
async function call(method, url, body, token, database=db, extra={}) {
  const response = await handleApi(new Request('https://duoxing.test/api'+url,{method,
    headers:{...headers,...(token?{Authorization:'Bearer '+token}:{}),...extra},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),database);
  const data=await response.json(); return {status:response.status,data,headers:response.headers};
}
async function create(hours=12) { const r=await call('POST','/rooms',{areaId:'nanping',durationHours:hours}); assert.equal(r.status,201); return r.data; }
async function pair() { const a=await create();const r=await call('POST','/rooms/'+a.roomCode+'/join',{});assert.equal(r.status,201);return [a,r.data]; }
const draft=(p,revision=1)=>({participantId:p.participantId,preferenceRevision:revision,budget:'unlimited',distance:'unlimited',spice:'any',cuisinePreferences:[]});
const read=p=>call('GET','/rooms/'+p.roomCode+'/me',undefined,p.participantToken);
const submit=(p,revision=1)=>call('PUT','/rooms/'+p.roomCode+'/preferences',draft(p,revision),p.participantToken);

test('四档寿命由服务端固定，旧客户端缺省为24小时',async()=>{
  for(const hours of [1,3,12,24]){const p=await create(hours); const row=await db.prepare('SELECT created_at, expires_at FROM duoxing_rooms WHERE code=?').bind(p.roomCode).first(); assert.equal(row.expires_at-row.created_at,hours*3600000);assert.equal(Date.parse(p.expiresAt),row.expires_at);}
  const r=await call('POST','/rooms',{areaId:'nanping'});assert.equal(r.status,201);const row=await db.prepare('SELECT created_at,expires_at FROM duoxing_rooms WHERE code=?').bind(r.data.roomCode).first();assert.equal(row.expires_at-row.created_at,86400000);
});
test('拒绝字符串、空值、任意结束时间和无效时长',async()=>{
  for(const body of [{durationHours:'12'},{durationHours:null},{durationHours:2},{durationHours:0},{durationHours:12,expiresAt:'2030-01-01'},null]) assert.equal((await call('POST','/rooms',body)).status,400);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM duoxing_rooms').first()).n,0);
});
test('Token原文只在创建加入返回，库中为哈希；缺失或错误凭据被拒绝',async()=>{
  const p=await create();assert.match(p.participantToken,/^[a-f0-9]{64}$/);const row=await db.prepare('SELECT state_json FROM duoxing_rooms WHERE code=?').bind(p.roomCode).first();assert.ok(!row.state_json.includes(p.participantToken));
  assert.equal((await call('GET','/rooms/'+p.roomCode+'/me')).status,401);assert.equal((await call('GET','/rooms/'+p.roomCode+'/me',undefined,'0'.repeat(64))).status,401);
  const r=await read(p);assert.equal(r.status,200);assert.ok(!JSON.stringify(r.data).includes(p.participantToken));assert.equal(r.headers.get('cache-control'),'no-store');
});
test('旧客户端没有升级头及旧参与者路由得到426',async()=>{
  assert.equal((await call('POST','/rooms',{},undefined,db,{'X-Duoxing-Auth':''})).status,426);
  const p=await create();assert.equal((await call('GET','/rooms/'+p.roomCode+'/participants/'+p.participantId,undefined,p.participantToken)).status,426);
});
test('20人同时抢第二个名额，恰好一个成功且数据库只有两人',async()=>{
  const p=await create();const results=await Promise.all(Array.from({length:20},()=>call('POST','/rooms/'+p.roomCode+'/join',{})));assert.equal(results.filter(r=>r.status===201).length,1);assert.ok(results.every(r=>[201,409,503].includes(r.status)));
  const r=await read(p);assert.equal(r.data.participantCount,2);
});
test('双方同时提交均保存，结果及轮次在两端一致',async()=>{
  const [a,b]=await pair();const results=await Promise.all([submit(a),submit(b)]);assert.deepEqual(results.map(r=>r.status),[200,200]);
  const [x,y]=await Promise.all([read(a),read(b)]);assert.equal(x.data.state,'revealed');assert.equal(x.data.submittedCount,2);assert.equal(x.data.preferenceRevision,1);assert.deepEqual(x.data.recommendations,y.data.recommendations);assert.ok(x.data.recommendations.length>0);
});
test('重选保留双方私有草稿并作废全部提交和旧结果',async()=>{
  const [a,b]=await pair();await submit(a);await submit(b);const r=await call('POST','/rooms/'+a.roomCode+'/reset',{participantId:a.participantId},a.participantToken);assert.equal(r.status,200);assert.equal(r.data.preferenceRevision,2);assert.equal(r.data.submittedCount,0);assert.deepEqual(r.data.recommendations,[]);
  for(const p of [a,b]){const s=await read(p);assert.equal(s.data.state,'choosing');assert.equal(s.data.ownDraft.budget,'unlimited');}
  assert.equal((await submit(a,1)).status,400);
});
test('重选与旧版本提交并发时最终没有旧提交残留',async()=>{
  const [a,b]=await pair();await submit(a);await submit(b);
  const [reset,result]=await Promise.all([call('POST','/rooms/'+a.roomCode+'/reset',{participantId:a.participantId},a.participantToken),submit(b,1)]);assert.equal(reset.status,200);assert.ok([200,400].includes(result.status));
  const r=await read(a);assert.ok(r.data.preferenceRevision>=2);assert.equal(r.data.submittedCount,0);assert.deepEqual(r.data.recommendations,[]);
});
test('并发换组逐次前进且不会丢失更新',async()=>{
  const [a,b]=await pair();await submit(a);await submit(b);const initial=(await read(a)).data;assert.equal(initial.hasMoreRecommendations,true);
  const results=await Promise.all([a,b].map(p=>call('POST','/rooms/'+p.roomCode+'/recommendations/reroll',{participantId:p.participantId},p.participantToken)));assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
  const row=await db.prepare('SELECT state_json FROM duoxing_rooms WHERE code=?').bind(a.roomCode).first();const state=JSON.parse(row.state_json);assert.equal(state.recommendationPage,results.filter(r=>r.status===200).length);
});
test('本人草稿隔离，伪造伙伴ID不能读写，重复菜系被拒绝',async()=>{
  const [a,b]=await pair();let payload={...draft(a),nickname:'私有甲',cuisinePreferences:[{cuisine:'日料',attitude:'love'}]};assert.equal((await call('PUT','/rooms/'+a.roomCode+'/preferences',payload,a.participantToken)).status,200);
  const r=await read(b);assert.equal(r.data.ownDraft,null);assert.ok(!JSON.stringify(r.data).includes('私有甲'));assert.ok(!JSON.stringify(r.data).includes(a.participantId));
  assert.equal((await call('PUT','/rooms/'+a.roomCode+'/preferences',draft(b),a.participantToken)).status,403);
  payload={...draft(b),cuisinePreferences:[{cuisine:'日料',attitude:'love'},{cuisine:'日料',attitude:'avoid'}]};assert.equal((await call('PUT','/rooms/'+b.roomCode+'/preferences',payload,b.participantToken)).status,400);
});
test('读取加入提交重选换组都不会续期',async()=>{
  const [a,b]=await pair();const original=a.expiresAt;await read(a);await submit(a);await submit(b);await call('POST','/rooms/'+a.roomCode+'/recommendations/reroll',{participantId:a.participantId},a.participantToken);await call('POST','/rooms/'+a.roomCode+'/reset',{participantId:a.participantId},a.participantToken);assert.equal((await read(a)).data.expiresAt,original);
});
test('过期立即拒绝，只有有效Token的读取能获知明确到期标志',async()=>{
  const p=await create();await db.prepare('UPDATE duoxing_rooms SET expires_at=? WHERE code=?').bind(Date.now()-1,p.roomCode).run();
  const r=await read(p);assert.equal(r.status,401);assert.equal(r.data.code,'ROOM_EXPIRED');
  const invalid=await call('GET','/rooms/'+p.roomCode+'/me',undefined,'f'.repeat(64));assert.equal(invalid.status,401);assert.equal(invalid.data.code,undefined);
  assert.equal((await call('POST','/rooms/'+p.roomCode+'/join',{})).data.code,'ROOM_EXPIRED');
  for(const [method,suffix,body] of [['PUT','preferences',draft(p)],['POST','reset',{participantId:p.participantId}],['POST','recommendations/reroll',{participantId:p.participantId}]]){const r=await call(method,'/rooms/'+p.roomCode+'/'+suffix,body,p.participantToken);assert.equal(r.status,401);assert.equal(r.data.code,undefined);}
});
test('物理清理每次最多100个，活跃饭局及其内容不受影响',async()=>{
  const active=await create();const state=JSON.stringify({participants:[],round:1,recommendationPage:0});
  for(let i=0;i<105;i++)await db.prepare('INSERT INTO duoxing_rooms(code,created_at,expires_at,version,state_json) VALUES(?,?,?,?,?)').bind('old'+i,0,1,0,state).run();
  assert.equal(await cleanupExpiredRooms(db),100);assert.equal((await db.prepare('SELECT count(*) AS n FROM duoxing_rooms').first()).n,6);assert.equal((await read(active)).status,200);assert.equal(await cleanupExpiredRooms(db),5);
});
test('连续竞争达到重试上限后返回503，不覆盖其他写入',async()=>{
  const p=await create();let conflicts=0;
  const contested={prepare(sql){const statement=db.prepare(sql);if(!sql.startsWith('UPDATE duoxing_rooms SET state_json'))return statement;
    return {bind(...params){const bound=statement.bind(...params);return {async run(){conflicts++;await db.prepare('UPDATE duoxing_rooms SET version=version+1 WHERE code=?').bind(p.roomCode).run();return bound.run();}};}};}};
  const r=await call('POST','/rooms/'+p.roomCode+'/join',{},undefined,contested);assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'1');assert.equal(conflicts,6);assert.equal((await read(p)).data.participantCount,1);
});
test('损坏JSON、未知路由和错误方法不会泄露内部异常',async()=>{
  const response=await handleApi(new Request('https://duoxing.test/api/rooms',{method:'POST',headers,body:'{broken'}),db);assert.equal(response.status,400);
  assert.equal((await call('GET','/missing')).status,404);assert.equal((await call('DELETE','/rooms')).status,405);
});

const realHeaders={'X-Duoxing-Client':'restaurants-v1'};
const realCreate=async(areaId='nanping')=>call('POST','/rooms',{areaId,durationHours:12},undefined,db,realHeaders);
test('v1.3必须先选择有效片区，旧缓存创建被要求刷新',async()=>{
 assert.equal((await call('POST','/rooms',{durationHours:12},undefined,db,realHeaders)).status,400);
 assert.equal((await realCreate('missing')).status,400);
 assert.equal((await call('POST','/rooms',{},undefined,db,{'X-Duoxing-Client':''})).status,426);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM duoxing_rooms').first()).n,0);
});
test('四片区固定在饭局中且完整候选快照持久化，旧缓存不能占用名额',async()=>{
 for(const areaId of ['nanping','danzishi','chayuan','cqupt']){
 const created=await realCreate(areaId);assert.equal(created.status,201);const a=created.data;
 const old=await call('POST','/rooms/'+a.roomCode+'/join',{},undefined,db,{'X-Duoxing-Client':''});assert.equal(old.status,426);
 const current=await call('GET','/rooms/'+a.roomCode+'/me',undefined,a.participantToken,db,realHeaders);
 assert.equal(current.status,200);assert.equal(current.data.areaId,areaId);assert.equal(current.data.participantCount,1);
 assert.equal((await call('GET','/rooms/'+a.roomCode+'/me',undefined,a.participantToken,db,{'X-Duoxing-Client':''})).status,426);
 const row=await db.prepare('SELECT state_json FROM duoxing_rooms WHERE code=?').bind(a.roomCode).first();
 const saved=JSON.parse(row.state_json);assert.equal(saved.areaId,areaId);assert.ok(saved.catalogVersion);assert.ok(Array.isArray(saved.candidates));assert.ok(saved.candidates.every(r=>r.areaId===areaId));
 }
});
test('真实饭局严格排除未知人均，忽略伪造距离并保持候选快照不变',async()=>{
 const a=(await realCreate()).data;
 const b=(await call('POST','/rooms/'+a.roomCode+'/join',{},undefined,db,realHeaders)).data;
 const row=await db.prepare('SELECT state_json FROM duoxing_rooms WHERE code=?').bind(a.roomCode).first();
 const saved=JSON.parse(row.state_json);
 saved.candidates=[49,50,51,100,101,null].map((price,index)=>({id:'fixture-'+index,areaId:'nanping',name:'独立测试门店'+index,address:'测试地址'+index,cuisine:'中餐',averagePrice:price,priceSource:price===null?null:'https://example.com/menu',sourceUrl:'https://example.com/store',checkedAt:'2026-10-24',spicyLevel:null}));
 await db.prepare('UPDATE duoxing_rooms SET state_json=? WHERE code=?').bind(JSON.stringify(saved),a.roomCode).run();
 for(const [budget,count] of [['1',2],['2',4],['3',5],['unlimited',6]]){
 if(budget!=='1')await call('POST','/rooms/'+a.roomCode+'/reset',{participantId:a.participantId},a.participantToken,db,realHeaders);
 const status=await call('GET','/rooms/'+a.roomCode+'/me',undefined,a.participantToken,db,realHeaders);
 for(const p of [a,b])assert.equal((await call('PUT','/rooms/'+a.roomCode+'/preferences',{...draft(p,status.data.preferenceRevision),budget,distance:'1'},p.participantToken,db,realHeaders)).status,200);
 const r=await call('GET','/rooms/'+a.roomCode+'/me',undefined,a.participantToken,db,realHeaders);
 assert.equal(r.data.candidateCount,count);assert.equal(r.data.ownDraft.distance,'unlimited');assert.ok(r.data.recommendations.every(x=>x.distance===null));assert.equal(r.data.areaId,'nanping');assert.equal(r.data.recommendations[0].address,'测试地址0');
 const beforeNames=r.data.recommendations.map(x=>x.id);if(r.data.hasMoreRecommendations){const next=await call('POST','/rooms/'+a.roomCode+'/recommendations/reroll',{participantId:a.participantId},a.participantToken,db,realHeaders);assert.ok(next.data.recommendations.every(x=>!beforeNames.includes(x.id)));}
 }
});
test('已有旧饭局保持原推荐与数字距离，新客户端仍能读取',async()=>{
 const token='a'.repeat(64);const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 const participants=['old-a','old-b'].map(id=>({id,tokenHash:id==='old-a'?hash:'b'.repeat(64),nickname:id,submittedAt:Date.now(),preferences:{...draft({participantId:id}),nickname:id}}));
 await db.prepare('INSERT INTO duoxing_rooms(code,created_at,expires_at,version,state_json) VALUES(?,?,?,?,?)').bind('OLD1',Date.now(),Date.now()+3600000,0,JSON.stringify({round:1,recommendationPage:0,participants})).run();
 const r=await call('GET','/rooms/OLD1/me',undefined,token,db,realHeaders);assert.equal(r.status,200);assert.equal(r.data.recommendations.length,3);assert.equal(typeof r.data.recommendations[0].distance,'number');assert.equal(r.data.areaId,undefined);
});
