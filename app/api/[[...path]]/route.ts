import { env } from 'cloudflare:workers';
import { handleApi } from '../../../server/api';
export const dynamic='force-dynamic';
async function dispatch(request:Request){if(!env.DB)return Response.json({error:'饭局暂时打不开，请稍后再试。'},{status:503,headers:{'Cache-Control':'no-store'}});return handleApi(request,env.DB);}
export {dispatch as GET,dispatch as POST,dispatch as PUT,dispatch as DELETE,dispatch as PATCH};
