// DRAFT: Kakeibo backend-only post-confirmed bank-to-bank transfer approval.
// HomeFlow never receives statement references, amounts or bank account IDs.
import {approvalRoute} from './approvals.js';
import {json,nowMs,constantEqualHex} from './security.js';
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i;
const deny=(code,status=403)=>json({ok:false,code,applied:false},status);
async function hmac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return [...new Uint8Array(mac)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function bankTransferApprovalSubmissionRoute(req,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.BANK_TRANSFER_APPROVAL_SUBMISSION_ENABLED!=='true'||
  !hex.test(env.BANK_TRANSFER_SUBMISSION_SECRET||'')||!env.DB?.prepare)
  return deny('bank_transfer_submission_disabled',503);
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||
  req.headers.get('x-approval-client')!=='kakeibo-bank-transfer')
  return deny('backend_only',403);
 const stamp=req.headers.get('x-approval-timestamp')||'',
  sig=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !hex.test(sig))return deny('invalid_signature',403);
 let raw,b;try{raw=await req.text();if(raw.length>750)return deny('invalid_body',400);b=JSON.parse(raw)}
 catch{return deny('invalid_body',400)}
 if(!b||Array.isArray(b)||typeof b!=='object'||
  Object.keys(b).sort().join(',')!==[
   'household_id','requester_user_id','resource_id','payload_sha256','expected_version'
  ].sort().join(',')||
  !id.test(b.resource_id)||!hex.test(b.payload_sha256)||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128||
  !Number.isSafeInteger(b.expected_version)||b.expected_version<1)
  return deny('invalid_body',400);
 const computed=await hmac(env.BANK_TRANSFER_SUBMISSION_SECRET,
  'kakeibo-bank-transfer:submit',stamp,raw);
 if(!constantEqualHex(computed,sig))return deny('invalid_signature');
 const key='kakeibo:bank-transfer:'+b.resource_id;
 const input={source_app:'kakebo',target_app:'kakebo',
  operation:'finance.asset_transfer.bank_to_bank',resource_type:'bank_transfer_posted',
  resource_id:b.resource_id,payload_sha256:b.payload_sha256,idempotency_key:key,
  payload_schema_version:1,expected_version:b.expected_version};
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
  persisted.operation!=='finance.asset_transfer.bank_to_bank'||
  persisted.resource_type!=='bank_transfer_posted'||
  persisted.resource_id!==b.resource_id||persisted.payload_sha256!==b.payload_sha256||
  persisted.household_id!==b.household_id||
  persisted.requester_user_id!==b.requester_user_id||
  persisted.expected_version!==b.expected_version||persisted.idempotency_key!==key)
  return deny('approval_not_confirmed',503);
 return json({ok:true,approval_id:persisted.request_id,status:persisted.status,
  resource_id:b.resource_id,household_id:b.household_id,
  requester_user_id:b.requester_user_id,payload_sha256:b.payload_sha256,
  expected_version:b.expected_version,operation:'finance.asset_transfer.bank_to_bank',
  applied:false,replayed:result.replayed===true},r.status);
}
