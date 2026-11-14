// Stage D: signed document-assistant -> HomeFlow review request only.
// The caller is the document backend after a live HomeFlow SSO introspection.
// NEVER accept browser cookies/origins, raw document content or remote URL.
// No target executor is wired for document.sync.* at this stage.
import {approvalRoute} from './approvals.js'
import {json,constantEqualHex,nowMs} from './security.js'
const encoder=new TextEncoder()
const hash=/^[a-f0-9]{64}$/
const candidateId=/^[a-f0-9]{32}$/
const actions={
 'kakebo':'document.sync.finance',
 'homeflow':'document.sync.homeflow',
 'it-study-platform':'document.sync.study'
}
const fail=(code,status=403)=>json({ok:false,code,applied:false},status)
async function mac(secret,stamp,raw){
 const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16))
 const key=await crypto.subtle.importKey('raw',bytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(
  'jp-document-assistant\n'+stamp+'\n'+raw))
 return Array.from(new Uint8Array(signature),
  x=>x.toString(16).padStart(2,'0')).join('')
}
export async function documentApprovalSubmissionRoute(request,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.DOCUMENT_APPROVAL_SUBMISSION_ENABLED!=='true'||
  typeof env.DOCUMENT_APPROVAL_SUBMISSION_SECRET!=='string'||
  !hash.test(env.DOCUMENT_APPROVAL_SUBMISSION_SECRET)||
  !env.DB?.prepare)return fail('document_approval_submission_disabled',503)
 if(request.method!=='POST')return fail('method_not_allowed',405)
 if(request.headers.has('cookie')||request.headers.has('origin')||
  request.headers.has('authorization'))return fail('backend_only',403)
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return fail('invalid_content_type',400)
 const client=request.headers.get('x-approval-client')
 const stamp=request.headers.get('x-approval-timestamp')
 const signature=request.headers.get('x-approval-signature')
 if(client!=='jp-document-assistant'||typeof stamp!=='string'||
  !/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !hash.test(signature))return fail('unauthorized',403)
 let raw,body
 try{
  raw=await request.text()
  if(raw.length>1000)throw Error('too large')
  body=JSON.parse(raw)
 }catch{return fail('invalid_body',400)}
 if(!constantEqualHex(await mac(env.DOCUMENT_APPROVAL_SUBMISSION_SECRET,stamp,raw),signature))
  return fail('unauthorized',403)
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).length!==5||
  Object.keys(body).some(k=>!['household_id','requester_user_id','resource_id',
   'payload_sha256','target_app'].includes(k))||
  typeof body.household_id!=='string'||!body.household_id||
  body.household_id.length>128||
  typeof body.requester_user_id!=='string'||!body.requester_user_id||
  body.requester_user_id.length>128||
  !candidateId.test(body.resource_id)||!hash.test(body.payload_sha256)||
  !Object.hasOwn(actions,body.target_app))
  return fail('invalid_request',400)
 const operation=actions[body.target_app]
 const idempotencyKey='jpda:sync:'+body.resource_id
 const intent={source_app:'jp-document-assistant',
  target_app:body.target_app,operation,resource_type:'document_sync_candidate',
  resource_id:body.resource_id,payload_schema_version:1,
  payload_sha256:body.payload_sha256,idempotency_key:idempotencyKey}
 // Reuse the database-backed source of truth for household membership,
 // live role, immutable request and member actor audit.
 const internal=new Request(new URL('/api/approvals',request.url),{
  method:'POST',headers:{'content-type':'application/json',
   origin:new URL(request.url).origin},body:JSON.stringify(intent)
 })
 const response=await approvalRoute(internal,env,'/api/approvals',{
  household_id:body.household_id,user_id:body.requester_user_id})
 if(![200,201].includes(response.status))return response
 const view=await response.json()
 const id=view.request?.request_id
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||view.request?.applied!==false)
  return fail('approval_submission_unverified',503)
 const row=await env.DB.prepare('SELECT * FROM household_approval_requests WHERE request_id=?')
  .bind(id).first()
 if(!row||row.household_id!==body.household_id||
  row.requester_user_id!==body.requester_user_id||
  row.source_app!==intent.source_app||row.target_app!==intent.target_app||
  row.operation!==operation||row.resource_type!==intent.resource_type||
  row.resource_id!==body.resource_id||row.payload_sha256!==body.payload_sha256||
  row.idempotency_key!==idempotencyKey||row.status!==view.request.status)
  return fail('approval_submission_unverified',503)
 return json({ok:true,approval_id:id,status:row.status,
  target_app:body.target_app,resource_id:body.resource_id,
  payload_sha256:row.payload_sha256,household_id:row.household_id,
  requester_user_id:row.requester_user_id,replayed:view.replayed===true,
  applied:false,target_changed:false},response.status)
}
