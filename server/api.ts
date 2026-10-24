import { CreateRoomBody, GetRoomResponse, JoinRoomBody, SubmitPreferencesBody, ResetRoomBody, RerollRecommendationsBody } from '../shared/api-zod/generated/api.ts';
import { getRecommendations } from './meal-recommendations.ts';
import { candidatesForArea, CATALOG_VERSION, getRealRecommendations, type CatalogRestaurant } from './real-restaurants.ts';
import { isMealArea, type MealAreaId } from '../shared/meal-areas.ts';
import { ALGORITHM_VERSION } from './match-engine.ts';
import type { z } from 'zod';

type Preference = z.infer<typeof SubmitPreferencesBody>;
type Participant = { id:string; tokenHash:string; nickname:string; submittedAt:number|null; preferences:Preference|null };
type RoomState = { areaId?:MealAreaId; catalogVersion?:string; candidates?:CatalogRestaurant[]; round:number; recommendationPage:number; participants:Participant[] };
type RoomRow = { code:string; created_at:number; expires_at:number; version:number; state_json:string };
type Room = RoomRow & { state:RoomState };
class ApiFailure extends Error {
  status:number; code?:string; retryAfter?:string;
  constructor(status:number,message:string,code?:string,retryAfter?:string){super(message);this.status=status;this.code=code;this.retryAfter=retryAfter;}
}
const fail=(status:number,message:string,code?:string):never=>{throw new ApiFailure(status,message,code);};
const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}});
const genericMissing='房间或参与者不存在，或房间已过期。';
const invalidCredential='身份已失效或房间已过期，请刷新页面后重试。';
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
async function credential(){const token=hex(crypto.getRandomValues(new Uint8Array(32)));return {token,hash:await hashToken(token)};}
async function hashToken(token:string){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));}
function roomCode(){return Array.from(crypto.getRandomValues(new Uint8Array(4)),value=>alphabet[value%alphabet.length]).join('');}
async function load(database:D1Database,code:string):Promise<Room|null>{
  // Direct D1 queries use the primary; do not opt this room state into stale replicas.
  const row=await database.prepare('SELECT code, created_at, expires_at, version, state_json FROM duoxing_rooms WHERE code=?').bind(code).first<RoomRow>();
  return row?{...row,state:JSON.parse(row.state_json) as RoomState}:null;
}
function authenticate(room:Room|null,tokenHash:string|undefined,method:string,body:any):Participant{
  const participant=room?.state.participants.find(p=>p.tokenHash===tokenHash);
  if(!participant||!room) return fail(401,invalidCredential);
  if(room.expires_at<=Date.now())return fail(401,'房间已过期，无法继续使用。',method==='GET'?'ROOM_EXPIRED':undefined);
  if(body?.participantId!==undefined&&body.participantId!==participant.id)return fail(403,'不能修改其他参与者的选择，请刷新页面。');
  return participant;
}
function recommendations(room:Room){return room.state.areaId ? getRealRecommendations(room.state.participants.map(p=>p.preferences!),room.state.candidates??[],room.state.recommendationPage) : getRecommendations(room.state.participants.map(p=>p.preferences!),room.state.recommendationPage);}
function requireClient(request:Request,room?:Room|null){if((!room||room.state.areaId)&&request.headers.get('x-duoxing-client')!=='restaurants-v1')return fail(426,'餐厅推荐已升级，请联网刷新页面后继续。');}
function snapshot(room:Room,participantId:string){
  const participants=room.state.participants;
  const own=participants.find(p=>p.id===participantId);
  if(!own||room.expires_at<=Date.now())return fail(404,genericMissing);
  const valid=participants.filter(p=>p.submittedAt!==null&&p.preferences!==null);
  const revealed=participants.length===2&&valid.length===2;
  const result=revealed?recommendations(room):{recommendations:[],hasMoreRecommendations:false,candidateCount:0};
  return GetRoomResponse.parse({roomCode:room.code,expiresAt:new Date(room.expires_at).toISOString(),participantId:own.id,
    participantCount:participants.length,submittedCount:valid.length,requiredParticipantCount:2,
    hasSubmitted:valid.some(p=>p.id===own.id),ownDraft:own.preferences?{...own.preferences,nickname:own.nickname}:null,
    preferenceRevision:room.state.round,algorithmVersion:room.state.areaId?ALGORITHM_VERSION+"-real-1":ALGORITHM_VERSION,
    ...(room.state.areaId?{areaId:room.state.areaId,catalogVersion:room.state.catalogVersion}:{}),...result,
    state:revealed?'revealed':valid.some(p=>p.id===own.id)?participants.length<2?'waiting_for_partner':'waiting_for_other':'choosing'});
}
async function mutate<T>(database:D1Database,code:string,change:(room:Room)=>T):Promise<T>{
  // Every retry revalidates membership, expiry and the public preferenceRevision.
  for(let retry=0;retry<=5;retry++){
    const room=await load(database,code);
    if(!room) return fail(404,'没有找到这个房间，检查一下房间码。');
    const result=change(room);
    const write=await database.prepare('UPDATE duoxing_rooms SET state_json=?, version=version+1 WHERE code=? AND version=? AND expires_at>?')
      .bind(JSON.stringify(room.state),code,room.version,Date.now()).run();
    if(write.meta.changes===1)return result;
  }
  throw new ApiFailure(503,'饭局暂时忙，请稍后再试。',undefined,'1');
}
async function currentSnapshot(database:D1Database,code:string,id:string){const room=await load(database,code);if(!room)return fail(404,genericMissing);return snapshot(room,id);}

export async function handleApi(request:Request,database:D1Database):Promise<Response>{
  try{return await dispatch(request,database);}catch(error){
    if(error instanceof ApiFailure)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status,error.retryAfter?{'Retry-After':error.retryAfter}:{});
    // Never log SQL, request bodies, Authorization, participant IDs, or tokens.
    console.error('都行请求处理失败');
    return json({error:'饭局暂时打不开，请稍后再试。'},503,{'Retry-After':'1'});
  }
}
async function dispatch(request:Request,database:D1Database):Promise<Response>{
  let pathname:string;
  try{pathname=decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/,'');}catch{return fail(400,'请求格式不正确，请刷新页面后重试。');}
  const method=request.method.toUpperCase();
  if(pathname==='/api/healthz')return method==='GET'?json({status:'ok'}):json({error:'请求方法不支持。'},405);
  const create=/^\/api\/rooms$/i.test(pathname);
  const match=pathname.match(/^\/api\/rooms\/([a-z0-9]{4,6})\/(join|me|participants\/[^/]+|preferences|reset|recommendations\/reroll)$/i);
  if(!create&&!match)return json({error:'没有找到这个页面。'},404);
  const action=create?'create':match![2].toLowerCase();
  if(action.startsWith('participants/'))return fail(426,'应用已升级，请联网刷新页面或重新打开都行。旧房间身份不能继续使用。');
  const expectedMethod=action==='me'?'GET':action==='preferences'?'PUT':'POST';
  if(method!==expectedMethod)return json({error:'请求方法不支持。'},405,{'Allow':expectedMethod});
  if((create||action==='join')&&request.headers.get('x-duoxing-auth')!=='token-v1')return fail(426,'应用已升级，请联网刷新页面后再创建或加入房间。');
  let body:any;
  if(method!=='GET'){
    const text=await request.text();
    if(new TextEncoder().encode(text).byteLength>102400)return fail(413,'提交内容过大，请减少内容后重试。');
    try{body=text?JSON.parse(text):{};}catch{return fail(400,'请求格式不正确，请刷新页面后重试。');}
  }
  if(create){
    requireClient(request);
    if(!isMealArea(body?.areaId))return fail(400,'请先选择南岸区的就餐片区。');
    const areaId=body.areaId;
    const parsed=CreateRoomBody.safeParse(body);
    if(!parsed.success||body===null||Object.prototype.hasOwnProperty.call(body??{},'expiresAt'))return fail(400,'请选择1、3、12或24小时的饭局保留时间，不支持自定义结束时间。');
    for(let attempt=0;attempt<8;attempt++){
      const code=roomCode(),id=crypto.randomUUID(),issued=await credential(),createdAt=Date.now();
      const expiresAt=createdAt+(parsed.data.durationHours??24)*3600000;
      const state:RoomState={areaId,catalogVersion:CATALOG_VERSION,candidates:candidatesForArea(areaId),round:1,recommendationPage:0,participants:[{id,tokenHash:issued.hash,nickname:parsed.data.nickname?.trim()||'参与者 1',submittedAt:null,preferences:null}]};
      try{await database.prepare('INSERT INTO duoxing_rooms(code,created_at,expires_at,version,state_json) VALUES(?,?,?,?,?)').bind(code,createdAt,expiresAt,0,JSON.stringify(state)).run();}
      catch(error){if(error instanceof Error&&/UNIQUE constraint failed: duoxing_rooms.code/.test(error.message))continue;throw error;}
      return json({roomCode:code,participantId:id,participantToken:issued.token,expiresAt:new Date(expiresAt).toISOString()},201);
    }
    throw new ApiFailure(503,'暂时无法创建饭局，请稍后再试。',undefined,'1');
  }
  const code=match![1].toUpperCase();
  if(action==='join'){
    const parsed=JoinRoomBody.safeParse(body);if(!parsed.success)return fail(400,parsed.error.message);
    const id=crypto.randomUUID(),issued=await credential();
    const expiresAt=await mutate(database,code,room=>{
      if(room.expires_at<=Date.now())return fail(404,'这次饭局已经结束啦','ROOM_EXPIRED');
      requireClient(request,room);
      if(room.state.participants.length>=2)return fail(409,'这个房间已经坐满两个人了。');
      room.state.participants.push({id,tokenHash:issued.hash,nickname:parsed.data.nickname?.trim()||'参与者 2',submittedAt:null,preferences:null});return room.expires_at;
    });
    return json({roomCode:code,participantId:id,participantToken:issued.token,expiresAt:new Date(expiresAt).toISOString()},201);
  }
  const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if(!token||!/^[a-f0-9]{64}$/.test(token))return fail(401,'身份已失效或页面版本过旧，请联网刷新页面后重试。');
  const tokenHash=await hashToken(token);
  const initial=await load(database,code);
  const owner=authenticate(initial,tokenHash,method,body);
  requireClient(request,initial);
  if(action==='me')return json(snapshot(initial!,owner.id));
  const schema=action==='preferences'?SubmitPreferencesBody:action==='reset'?ResetRoomBody:RerollRecommendationsBody;
  const parsed=schema.safeParse({...body,participantId:owner.id});
  if(!parsed.success){
    const revisionIssue=parsed.error.issues.some(issue=>issue.path[0]==='preferenceRevision');
    return fail(400,revisionIssue?'页面版本过旧或尚未同步，请刷新页面后重新填写并提交；这次选择尚未保存。':parsed.error.message);
  }
  const submitted=action==='preferences'?SubmitPreferencesBody.parse(parsed.data):null;
  if(submitted&&new Set(submitted.cuisinePreferences.map(p=>p.cuisine)).size!==submitted.cuisinePreferences.length)return fail(400,'同一菜系只能提交一种偏好。');
  await mutate(database,code,room=>{
    const participant=authenticate(room,tokenHash,method,body);
    if(action==='preferences'){
      if(submitted!.preferenceRevision!==room.state.round)return fail(400,'偏好版本已更新，请刷新页面后重新提交。');
      if(participant.submittedAt!==null){for(const p of room.state.participants)p.submittedAt=null;room.state.round++;room.state.recommendationPage=0;}
      participant.preferences=room.state.areaId?{...submitted!,distance:"unlimited"}:submitted!;
      if(submitted!.nickname!==undefined)participant.nickname=submitted!.nickname.trim()||participant.nickname;
      participant.submittedAt=Date.now();
    }else if(action==='reset'){
      for(const p of room.state.participants)p.submittedAt=null;
      room.state.round++;room.state.recommendationPage=0;
    }else{
      const participants=room.state.participants;
      if(participants.length!==2||participants.some(p=>p.submittedAt===null||p.preferences===null))return fail(409,'双方完成选择后才能更换推荐。');
      if(!recommendations(room).hasMoreRecommendations)return fail(409,'暂时没有更多符合条件的推荐。');
      room.state.recommendationPage++;
    }
  });
  return json(await currentSnapshot(database,code,owner.id));
}
export async function cleanupExpiredRooms(database:D1Database):Promise<number>{
  const now=Date.now();const result=await database.prepare('DELETE FROM duoxing_rooms WHERE code IN (SELECT code FROM duoxing_rooms WHERE expires_at<=? ORDER BY expires_at,code LIMIT 100) AND expires_at<=?').bind(now,now).run();return result.meta.changes;
}
