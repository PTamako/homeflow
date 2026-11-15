// Signed, read-only evidence of independent member/recipient consent + distinct
// household owner authorization. NOT a Kakeibo execution permit or bank proof.
// Kakeibo must separately check both account owners/CAS, actual bank statements,
// original encrypted intent and its own irreversible ledger journal.
import {json,nowMs,constantEqualHex} from './security.js';

const h64=/^[a-f0-9]{64}$/i;
const id32=/^[a-f0-9]{32}$/i;
const id36=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enc=new TextEncoder();
const deny=(code,status=403)=>json({ok:false,code,consent_verified:false,ledger_applied:false},status);
const exact=(x,fields)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',');
async function sign(secret,timestamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>Number.parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,
  enc.encode('kakeibo-cross-member:consent-proof\n'+timestamp+'\n'+raw));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function crossMemberConsentProofRoute(request,env){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED!=='true'||
  env.CROSS_MEMBER_TRANSFER_PROOF_ENABLED!=='true'||
  !h64.test(env.CROSS_MEMBER_TRANSFER_PROOF_SECRET||'')||!env.DB?.prepare)
  return deny('cross_transfer_proof_disabled',503);
 if(request.method!=='POST'||request.headers.has('cookie')||
  request.headers.has('origin')||request.headers.has('authorization')||
  request.headers.get('x-approval-client')!=='kakeibo-cross-member'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('backend_only');
 const stamp=request.headers.get('x-approval-timestamp')||'',
  provided=request.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !h64.test(provided))return deny('invalid_signature');
 let raw,b;
 try{
  raw=await request.text();
  if(raw.length>1100)return deny('invalid_body',400);
  b=JSON.parse(raw);
 }catch{return deny('invalid_body',400)}
 if(!exact(b,['consent_id','resource_id','household_id','source_user_id',
  'recipient_user_id','payload_sha256','source_account_version',
  'recipient_account_version'])||
  !id36.test(b.consent_id)||!id32.test(b.resource_id)||!h64.test(b.payload_sha256)||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.source_user_id!=='string'||!b.source_user_id||b.source_user_id.length>128||
  typeof b.recipient_user_id!=='string'||!b.recipient_user_id||b.recipient_user_id.length>128||
  b.source_user_id===b.recipient_user_id||
  !Number.isSafeInteger(b.source_account_version)||b.source_account_version<1||
  !Number.isSafeInteger(b.recipient_account_version)||b.recipient_account_version<1)
  return deny('invalid_body',400);
 const computed=await sign(env.CROSS_MEMBER_TRANSFER_PROOF_SECRET,stamp,raw);
 if(!constantEqualHex(computed,provided.toLowerCase()))return deny('invalid_signature');
 const row=await env.DB.prepare(
  'SELECT c.*,s.role AS source_role,su.disabled_at AS source_disabled,'+
  'r.role AS recipient_role,ru.disabled_at AS recipient_disabled,'+
  'o.role AS owner_role,ou.disabled_at AS owner_disabled '+
  'FROM household_cross_member_transfer_consents c '+
  'LEFT JOIN household_members s ON s.household_id=c.household_id AND s.user_id=c.source_user_id '+
  'LEFT JOIN users su ON su.id=c.source_user_id '+
  'LEFT JOIN household_members r ON r.household_id=c.household_id AND r.user_id=c.recipient_user_id '+
  'LEFT JOIN users ru ON ru.id=c.recipient_user_id '+
  'LEFT JOIN household_members o ON o.household_id=c.household_id AND o.user_id=c.owner_authorizer_user_id '+
  'LEFT JOIN users ou ON ou.id=c.owner_authorizer_user_id '+
  'WHERE c.consent_id=? LIMIT 1').bind(b.consent_id).first();
 if(!row||row.household_id!==b.household_id||
  row.resource_id!==b.resource_id||row.payload_sha256!==b.payload_sha256||
  row.source_user_id!==b.source_user_id||row.recipient_user_id!==b.recipient_user_id||
  row.source_account_version!==b.source_account_version||
  row.recipient_account_version!==b.recipient_account_version||
  row.status!=='owner_authorized'||!Number.isSafeInteger(row.version)||row.version!==3||
  row.recipient_decided_at==null||row.owner_authorized_at==null||
  row.recipient_decided_at>=row.owner_authorized_at||
  row.owner_authorized_at>=row.expires_at||nowMs()>=row.expires_at||
  !['owner','member'].includes(row.source_role)||
  !['owner','member'].includes(row.recipient_role)||
  row.source_disabled!=null||row.recipient_disabled!=null||
  row.owner_role!=='owner'||row.owner_disabled!=null)
  return deny('cross_transfer_independent_consents_not_current',409);
 return json({ok:true,consent_verified:true,ledger_applied:false,
  consent_id:row.consent_id,resource_id:row.resource_id,payload_sha256:row.payload_sha256,
  household_id:row.household_id,source_user_id:row.source_user_id,
  recipient_user_id:row.recipient_user_id,
  source_account_version:row.source_account_version,
  recipient_account_version:row.recipient_account_version,
  owner_authorizer_user_id:row.owner_authorizer_user_id,
  consent_version:row.version,
  valid_until:row.expires_at,
  bank_statements_verified:false,
  target_ledger_authorized:false,
  requires_signed_bank_execution_and_account_owner_cas:true});
}
