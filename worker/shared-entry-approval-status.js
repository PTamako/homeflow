// Signed, read-only HomeFlow approval state for the requesting member's Kakeibo.
// No browser credentials, arbitrary household IDs, or unverified status claims.
import {json,nowMs,constantEqualHex} from './security.js'
const hex=/^[a-f0-9]{64}$/i,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const enc=new TextEncoder()
const deny=(code,status=403)=>json({ok:false,code},status)
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',')
async function mac(secret,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),
  x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode('kakeibo-shared-entry:status\n'+stamp+'\n'+raw))),
  b=>b.toString(16).padStart(2,'0')).join('')
}
export async function sharedEntryApprovalStatusRoute(request,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.SHARED_ENTRY_APPROVAL_SUBMISSION_ENABLED!=='true'||
  !hex.test(env.SHARED_ENTRY_SUBMISSION_SECRET||'')||!env.DB?.prepare)
  return deny('shared_entry_status_disabled',503)
 if(request.method!=='POST'||request.headers.has('origin')||
  request.headers.has('cookie')||request.headers.has('authorization')||
  request.headers.get('x-approval-client')!=='kakeibo-shared-entry'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('backend_only')
 const stamp=request.headers.get('x-approval-timestamp')||''
 const signature=request.headers.get('x-approval-signature')||''
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||!hex.test(signature))
  return deny('invalid_signature')
 let body,raw
 try{raw=await request.text();body=raw.length<=6500?JSON.parse(raw):null}
 catch{return deny('invalid_body',400)}
 if(!exact(body,['household_id','requester_user_id','approval_ids'])||
  typeof body.household_id!=='string'||!body.household_id||body.household_id.length>128||
  typeof body.requester_user_id!=='string'||!body.requester_user_id||
  body.requester_user_id.length>128||!Array.isArray(body.approval_ids)||
  body.approval_ids.length>60||body.approval_ids.some(x=>typeof x!=='string'||!uuid.test(x))||
  new Set(body.approval_ids).size!==body.approval_ids.length)
  return deny('invalid_status_query',400)
 if(!constantEqualHex(await mac(env.SHARED_ENTRY_SUBMISSION_SECRET,stamp,raw),
  signature.toLowerCase()))return deny('invalid_signature')
 const member=await env.DB.prepare(`SELECT m.role FROM household_members m
   JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
   WHERE m.household_id=?1 AND m.user_id=?2 LIMIT 1`)
  .bind(body.household_id,body.requester_user_id).first()
 if(member?.role!=='member')return deny('member_not_active')
 if(!body.approval_ids.length)return json({ok:true,items:[]})
 const placeholders=body.approval_ids.map(()=>'?').join(',')
 const result=await env.DB.prepare(`SELECT request_id,status,resource_id,operation
   FROM household_approval_requests
   WHERE household_id=? AND requester_user_id=? AND source_app='kakebo'
     AND target_app='kakebo' AND resource_type='shared_entry_mutation'
     AND request_id IN (${placeholders})`)
  .bind(body.household_id,body.requester_user_id,...body.approval_ids).all()
 return json({ok:true,items:(result.results||[]).map(x=>({
  approval_id:x.request_id,status:x.status,resource_id:x.resource_id,operation:x.operation
 }))})
}
