// Stage D: read-only proof for a target App's future idempotent executor.
// NEVER applies a financial action, never holds the private target payload,
// never marks an approval executed. Browser clients cannot access this route.
// This only answers whether HomeFlow *still* attests a particular immutable
// approval digest and living owner/member relationship.
import {json,constantEqualHex,nowMs,sha256} from './security.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash=/^[a-f0-9]{64}$/
const key=/^[a-z0-9._:-]{12,128}$/i
const resource=/^[a-z0-9:_./-]{1,100}$/i
const encoder=new TextEncoder()
const reject=(code,status=403)=>json({ok:false,code},status)
function active(env){
 return env.APPROVALS_ENABLED==='true'&&
  env.APPROVAL_VERIFICATION_ENABLED==='true'&&
  env.APP_ENV==='production'&&
  typeof env.APPROVAL_VERIFICATION_SECRET==='string'&&
  /^[a-f0-9]{64}$/i.test(env.APPROVAL_VERIFICATION_SECRET)&&
  !!env.DB?.prepare
}
async function signature(secret,client,stamp,raw){
 const keyBytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16))
 const hmac=await crypto.subtle.importKey('raw',keyBytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const message=client+'\n'+stamp+'\n'+raw
 const mac=await crypto.subtle.sign('HMAC',hmac,encoder.encode(message))
 return Array.from(new Uint8Array(mac),x=>x.toString(16).padStart(2,'0')).join('')
}
function valid(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return false
 if(Object.keys(body).some(k=>!['request_id','resource_id','household_id',
  'requester_user_id','payload_sha256','idempotency_key','expected_version',
  'purpose','execution_nonce'].includes(k)))
  return false
 if(!uuid.test(body.request_id)||!resource.test(body.resource_id)||
  !hash.test(body.payload_sha256)||!key.test(body.idempotency_key)||
  typeof body.household_id!=='string'||body.household_id.length>128||
  !body.household_id||typeof body.requester_user_id!=='string'||
  !body.requester_user_id||body.requester_user_id.length>128)return false
 if(body.purpose!==undefined&&body.purpose!=='execute')return false
 if(body.purpose==='execute'&&!hash.test(body.execution_nonce))return false
 if(body.purpose!=='execute'&&body.execution_nonce!==undefined)return false
 if(body.expected_version!==null&&body.expected_version!==undefined&&
  (!Number.isSafeInteger(body.expected_version)||body.expected_version<0))return false
 return true
}
export async function approvalVerificationRoute(request,env){
 if(!active(env))return reject('approval_verification_disabled',503)
 if(request.method!=='POST')return reject('method_not_allowed',405)
 if(request.headers.has('origin')||request.headers.has('cookie')||
  request.headers.has('authorization'))
  return reject('backend_only',403)
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return reject('invalid_content_type',400)
 const client=request.headers.get('x-approval-client')
 const stamp=request.headers.get('x-approval-timestamp')
 const mac=request.headers.get('x-approval-signature')
 if(client!=='kakeibo'||typeof stamp!=='string'||!/^\d{13}$/.test(stamp)||
  Math.abs(nowMs()-Number(stamp))>300000||
  typeof mac!=='string'||!hash.test(mac))
  return reject('unauthorized',403)
 let raw,body
 try{
  raw=await request.text()
  if(raw.length>2048)return reject('invalid_body',400)
  body=JSON.parse(raw)
 }catch{return reject('invalid_body',400)}
 const computed=await signature(env.APPROVAL_VERIFICATION_SECRET,client,stamp,raw)
 if(!constantEqualHex(computed,mac))return reject('unauthorized',403)
 if(!valid(body))return reject('invalid_request',400)
 // Exact equality with HomeFlow's immutable approval record is mandatory:
 // a valid signed request for a different member/digest/resource must fail.
 const row=await env.DB.prepare(
  "SELECT r.request_id,r.status,r.source_app,r.target_app,r.operation,"+
  "r.resource_type,r.resource_id,r.household_id,r.requester_user_id,"+
  "r.approver_user_id,r.payload_sha256,r.idempotency_key,r.expected_version,"+
  "r.reviewed_at,r.expires_at,r.execution_nonce_hash,r.execution_lease_until,"+
  "requester.role AS requester_role,"+
  "requester_user.disabled_at AS requester_disabled,"+
  "approver.role AS approver_role,approver_user.disabled_at AS approver_disabled "+
  "FROM household_approval_requests r "+
  "LEFT JOIN household_members requester ON requester.household_id=r.household_id "+
  "AND requester.user_id=r.requester_user_id "+
  "LEFT JOIN users requester_user ON requester_user.id=r.requester_user_id "+
  "LEFT JOIN household_members approver ON approver.household_id=r.household_id "+
  "AND approver.user_id=r.approver_user_id "+
  "LEFT JOIN users approver_user ON approver_user.id=r.approver_user_id "+
  "WHERE r.request_id=?1 LIMIT 1"
 ).bind(body.request_id).first()
 const forExecution=body.purpose==='execute'
 if(!row||(forExecution?row.status!=='executing':row.status!=='approved')||
  row.source_app!=='kakebo'||
  row.target_app!=='kakebo'||row.operation!=='finance.entry.create'||
  row.resource_type!=='finance_entry'||
  row.resource_id!==body.resource_id||row.household_id!==body.household_id||
  row.requester_user_id!==body.requester_user_id||
  row.payload_sha256!==body.payload_sha256||
  row.idempotency_key!==body.idempotency_key||
  (row.expected_version??null)!==(body.expected_version??null)||
  row.requester_role!=='member'||row.requester_disabled!=null||
  row.approver_role!=='owner'||row.approver_disabled!=null||
  row.approver_user_id===row.requester_user_id||
  !row.reviewed_at||Number(row.expires_at)<=nowMs()||
  (forExecution&&(
   !row.execution_nonce_hash||Number(row.execution_lease_until)<=nowMs()||
   !constantEqualHex(await sha256(body.execution_nonce),row.execution_nonce_hash)
  )))
  return reject('approval_not_executable',409)
 // No decision-derived state transitions and no per-read audit inserts.
 return json({ok:true,verified:true,request_id:row.request_id,
  resource_id:row.resource_id,payload_sha256:row.payload_sha256,
  idempotency_key:row.idempotency_key,household_id:row.household_id,
  requester_user_id:row.requester_user_id,expected_version:row.expected_version,
  approver_user_id:row.approver_user_id,
  approved_at:row.reviewed_at,expires_at:row.expires_at,
  execution_authorized:forExecution,execution_status:row.status,
  applied:false,ledger_changed:false})
}
