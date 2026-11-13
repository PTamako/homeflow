// Stage D: trusted Kakeibo -> HomeFlow pending-approval submission.
// The HMAC proves this intent came from the backend that has already verified
// the member's live HomeFlow source session. No browser cookies/origins.
// NO target payload, bank data or monetary amount are sent or retained.
// This does NOT approve, execute or mutate a financial entry.
import {approvalRoute} from './approvals.js'
import {json,constantEqualHex,nowMs} from './security.js'
const enc=new TextEncoder()
const hash=/^[a-f0-9]{64}$/
const shortId=/^[a-f0-9]{32}$/
const reject=(code,status=403)=>json({ok:false,code},status)
async function expectedMac(secret,client,stamp,raw){
 const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16))
 const cryptoKey=await crypto.subtle.importKey('raw',bytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const value=client+'\n'+stamp+'\n'+raw
 const mac=await crypto.subtle.sign('HMAC',cryptoKey,enc.encode(value))
 return Array.from(new Uint8Array(mac),x=>x.toString(16).padStart(2,'0')).join('')
}
export async function approvalSubmissionRoute(request,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.APPROVAL_SUBMISSION_ENABLED!=='true'||
  typeof env.APPROVAL_VERIFICATION_SECRET!=='string'||
  !hash.test(env.APPROVAL_VERIFICATION_SECRET)||
  !env.DB?.prepare)
  return reject('approval_submission_disabled',503)
 if(request.method!=='POST')return reject('method_not_allowed',405)
 if(request.headers.has('cookie')||request.headers.has('origin')||
  request.headers.has('authorization'))
  return reject('backend_only',403)
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return reject('invalid_content_type',400)
 const client=request.headers.get('x-approval-client')
 const stamp=request.headers.get('x-approval-timestamp')
 const mac=request.headers.get('x-approval-signature')
 if(client!=='kakeibo'||typeof stamp!=='string'||!/^\d{13}$/.test(stamp)||
  Math.abs(nowMs()-Number(stamp))>300000||!hash.test(mac))
  return reject('unauthorized',403)
 let raw,body
 try{
  raw=await request.text()
  if(raw.length>1024)throw Error('invalid_length')
  body=JSON.parse(raw)
 }catch{return reject('invalid_body',400)}
 const computed=await expectedMac(env.APPROVAL_VERIFICATION_SECRET,client,stamp,raw)
 if(!constantEqualHex(computed,mac))return reject('unauthorized',403)
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).some(k=>!['household_id','requester_user_id','resource_id','payload_sha256'].includes(k))||
  Object.keys(body).length!==4||
  typeof body.household_id!=='string'||body.household_id.length<1||
  body.household_id.length>128||
  typeof body.requester_user_id!=='string'||body.requester_user_id.length<1||
  body.requester_user_id.length>128||
  !shortId.test(body.resource_id)||!hash.test(body.payload_sha256))
  return reject('invalid_request',400)
 const key='kakeibo:finance:'+body.resource_id
 const submission={
  source_app:'kakebo',target_app:'kakebo',
  operation:'finance.entry.create',resource_type:'finance_entry',
  resource_id:body.resource_id,payload_sha256:body.payload_sha256,
  idempotency_key:key,payload_schema_version:1
 }
 // Reuse the existing HomeFlow member role validation, immutable request
 // insert and append-only actor audit. Never bypass the D1 role check or
 // pretend to be a browser with a real session cookie.
 const internal=new Request(new URL('/api/approvals',request.url),{
  method:'POST',headers:{'content-type':'application/json',
   'origin':new URL(request.url).origin},body:JSON.stringify(submission)
 })
 const result=await approvalRoute(internal,env,'/api/approvals',{
  household_id:body.household_id,user_id:body.requester_user_id})
 if(![200,201].includes(result.status))return result
 const detail=await result.json()
 const row=detail.request
 if(!row||row.source_app!=='kakebo'||row.target_app!=='kakebo'||
  row.operation!=='finance.entry.create'||row.resource_type!=='finance_entry'||
  row.requester_user_id!==body.requester_user_id||
  row.resource_id!==body.resource_id||
  row.payload_sha256!==body.payload_sha256||
  row.idempotency_key!==undefined||
  !/^[a-f0-9-]{36}$/i.test(row.request_id)||row.applied!==false)
  // The legacy public shape omits idempotency_key. The idempotent DB record
  // is authoritative; never manufacture a success from a malformed response.
  return reject('approval_submission_unverified',503)
 return json({ok:true,approval_id:row.request_id,status:row.status,
  resource_id:row.resource_id,payload_sha256:row.payload_sha256,
  requester_user_id:row.requester_user_id,household_id:body.household_id,
  idempotency_key:key,replayed:detail.replayed===true,
  applied:false,ledger_changed:false},result.status)
}
