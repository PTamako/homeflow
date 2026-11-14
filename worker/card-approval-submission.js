// Trusted Kakeibo -> HomeFlow credit-card purchase approval submission.
// No card number, amount, merchant or private account label enters HomeFlow.
// Approval-only; posting is a separate leased, signed target transaction.
import {approvalRoute} from './approvals.js';
import {json,nowMs,constantEqualHex} from './security.js';
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i;
const deny=(code,status=403)=>json({ok:false,code,applied:false},status);
async function hmac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function cardApprovalSubmissionRoute(req,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.CARD_APPROVAL_SUBMISSION_ENABLED!=='true'||!hex.test(env.CARD_SUBMISSION_SECRET||'')||
  !env.DB?.prepare)return deny('card_submission_disabled',503);
 if(req.method!=='POST'||req.headers.has('cookie')||req.headers.has('origin')||
  req.headers.has('authorization')||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||
  req.headers.get('x-approval-client')!=='kakeibo-card')return deny('backend_only');
 const stamp=req.headers.get('x-approval-timestamp')||'',
  signature=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !hex.test(signature))return deny('invalid_signature');
 let raw,b;try{raw=await req.text();if(raw.length>1000)throw Error('long');b=JSON.parse(raw)}
 catch{return deny('invalid_body',400)}
 if(!b||Array.isArray(b)||typeof b!=='object'||
  Object.keys(b).sort().join(',')!==
   ['household_id','requester_user_id','resource_id','payload_sha256','expected_version'].sort().join(',')||
  !id.test(b.resource_id)||!hex.test(b.payload_sha256)||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128||
  !Number.isSafeInteger(b.expected_version)||b.expected_version<1)
  return deny('invalid_body',400);
 const computed=await hmac(env.CARD_SUBMISSION_SECRET,'kakeibo-card:submit',stamp,raw);
 if(!constantEqualHex(computed,signature))return deny('invalid_signature');
 const key='kakeibo:card:'+b.resource_id;
 const input={source_app:'kakebo',target_app:'kakebo',
  operation:'finance.credit_card.purchase',resource_type:'credit_card_purchase',
  resource_id:b.resource_id,payload_sha256:b.payload_sha256,
  idempotency_key:key,payload_schema_version:1,expected_version:b.expected_version};
 const local=new Request(new URL('/api/approvals',req.url),{method:'POST',
  headers:{origin:new URL(req.url).origin,'content-type':'application/json'},
  body:JSON.stringify(input)});
 const r=await approvalRoute(local,env,'/api/approvals',{
  household_id:b.household_id,user_id:b.requester_user_id});
 if(![200,201].includes(r.status))return r;
 const result=await r.json();
 const approval=result.request;
 if(!approval||approval.applied!==false||!approval.request_id)return deny('approval_not_confirmed',503);
 const persisted=await env.DB.prepare('SELECT * FROM household_approval_requests WHERE request_id=?')
  .bind(approval.request_id).first();
 if(!persisted||persisted.source_app!=='kakebo'||persisted.target_app!=='kakebo'||
  persisted.operation!=='finance.credit_card.purchase'||persisted.resource_type!=='credit_card_purchase'||
  persisted.resource_id!==b.resource_id||persisted.payload_sha256!==b.payload_sha256||
  persisted.household_id!==b.household_id||
  persisted.requester_user_id!==b.requester_user_id||
  persisted.expected_version!==b.expected_version||
  persisted.idempotency_key!==key)return deny('approval_not_confirmed',503);
 return json({ok:true,approval_id:persisted.request_id,status:persisted.status,
  resource_id:b.resource_id,household_id:b.household_id,
  requester_user_id:b.requester_user_id,payload_sha256:b.payload_sha256,
  expected_version:b.expected_version,applied:false,replayed:result.replayed===true},r.status);
}
