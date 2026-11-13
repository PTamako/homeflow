// Stage D: read-only, signed status verification for document assistant.
// This is NOT an approval execution proof and grants no target write authority.
import {json,constantEqualHex,nowMs} from './security.js'

const enc=new TextEncoder()
const hex64=/^[a-f0-9]{64}$/
const candidateId=/^[a-f0-9]{32}$/
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const operations={
 'kakebo':'document.sync.finance',
 'homeflow':'document.sync.homeflow',
 'it-study-platform':'document.sync.study'
}
const deny=(code,status=403)=>json({ok:false,code,applied:false,target_changed:false},status)
async function mac(secret,stamp,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signature=await crypto.subtle.sign('HMAC',key,
  enc.encode('jp-document-assistant:status\n'+stamp+'\n'+raw))
 return Array.from(new Uint8Array(signature),
  x=>x.toString(16).padStart(2,'0')).join('')
}
export async function documentApprovalStatusRoute(request,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.DOCUMENT_APPROVAL_SUBMISSION_ENABLED!=='true'||
  typeof env.DOCUMENT_APPROVAL_SUBMISSION_SECRET!=='string'||
  !hex64.test(env.DOCUMENT_APPROVAL_SUBMISSION_SECRET)||!env.DB?.prepare)
  return deny('document_approval_status_disabled',503)
 if(request.method!=='POST')return deny('method_not_allowed',405)
 // A browser request is not an authenticated document-assistant backend.
 if(request.headers.has('cookie')||request.headers.has('origin')||
  request.headers.has('authorization'))return deny('backend_only')
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return deny('invalid_content_type',400)
 const client=request.headers.get('x-approval-client')
 const stamp=request.headers.get('x-approval-timestamp')
 const signature=request.headers.get('x-approval-signature')
 if(client!=='jp-document-assistant'||typeof stamp!=='string'||
  !/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !hex64.test(signature))return deny('unauthorized')
 let raw,body
 try{
  raw=await request.text()
  if(raw.length>1100)throw Error('too_long')
  body=JSON.parse(raw)
 }catch{return deny('invalid_body',400)}
 if(!constantEqualHex(await mac(env.DOCUMENT_APPROVAL_SUBMISSION_SECRET,stamp,raw),signature))
  return deny('unauthorized')
 const expected=['approval_id','household_id','requester_user_id',
  'resource_id','payload_sha256','target_app']
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).length!==expected.length||
  Object.keys(body).some(k=>!expected.includes(k))||
  !uuid.test(body.approval_id)||
  typeof body.household_id!=='string'||!body.household_id||
  body.household_id.length>128||
  typeof body.requester_user_id!=='string'||!body.requester_user_id||
  body.requester_user_id.length>128||
  !candidateId.test(body.resource_id)||!hex64.test(body.payload_sha256)||
  !Object.hasOwn(operations,body.target_app))
  return deny('invalid_request',400)
 // Do not trust HMAC to confer any current role: an account can be disabled
 // or removed after the original review submission.
 const member=await env.DB.prepare(`SELECT m.role
  FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=? AND m.user_id=? AND u.disabled_at IS NULL
  LIMIT 1`).bind(body.household_id,body.requester_user_id).first()
 if(member?.role!=='member')return deny('not_authenticated',401)
 const row=await env.DB.prepare(`SELECT request_id,household_id,requester_user_id,
   source_app,target_app,operation,resource_type,resource_id,
   payload_schema_version,payload_sha256,idempotency_key,status,
   reviewed_at,expires_at,version
  FROM household_approval_requests WHERE request_id=? LIMIT 1`)
  .bind(body.approval_id).first()
 // Do not distinguish an absent approval from somebody else's approval,
 // wrong target, wrong digest, or a stale document account mapping.
 if(!row||row.household_id!==body.household_id||
  row.requester_user_id!==body.requester_user_id||
  row.source_app!=='jp-document-assistant'||
  row.target_app!==body.target_app||
  row.operation!==operations[body.target_app]||
  row.resource_type!=='document_sync_candidate'||
  row.resource_id!==body.resource_id||
  row.payload_schema_version!==1||
  row.payload_sha256!==body.payload_sha256||
  row.idempotency_key!=='jpda:sync:'+body.resource_id)
  return deny('not_found',404)
 // No document.sync.* target executor exists yet: anomalous "applied"
 // states must never be presented as a valid write confirmation.
 if(!['pending','approved','rejected','cancelled','expired',
   'failed_final','conflict'].includes(row.status))
  return deny('document_execution_not_supported',503)
 return json({ok:true,approval_id:row.request_id,
  status:row.status,household_id:row.household_id,
  requester_user_id:row.requester_user_id,
  resource_id:row.resource_id,target_app:row.target_app,
  payload_sha256:row.payload_sha256,version:row.version,
  reviewed_at:row.reviewed_at||null,expires_at:row.expires_at,
  applied:false,target_changed:false})
}
