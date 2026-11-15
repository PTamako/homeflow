// DRAFT P0-4C: signed Kakeibo per-month occurrence reservation, NOT
// recurring ledger execution. Reservation is permanent until a future
// independently verified target receipt/reconciliation protocol is designed.
import {json,nowMs,constantEqualHex} from './security.js';
const h64=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i,
 uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const month=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(s);
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const deny=(code,status=409)=>json({ok:false,code,ledger_applied:false},status);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const keys=['occurrence_id','policy_id','household_id','member_user_id','plan_resource_id',
 'plan_payload_sha256','source_account_version','period_key','due_date',
 'amount_jpy','entry_intent_sha256'];
const response=(x,replayed)=>json({
 ok:true,reserved_only:true,ledger_applied:false,execution_permitted:false,
 requires_target_bank_or_securities_execution_and_receipt:true,
 occurrence_id:x.occurrence_id,policy_id:x.policy_id,
 household_id:x.household_id,member_user_id:x.member_user_id,
 plan_resource_id:x.plan_resource_id,plan_payload_sha256:x.plan_payload_sha256,
 source_account_version:x.source_account_version,period_key:x.period_key,
 due_date:x.due_date,amount_jpy:x.amount_jpy,
 entry_intent_sha256:x.entry_intent_sha256,replayed
});
async function sign(secret,mode,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>Number.parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},
  false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(
  'kakeibo-recurring-finance:'+mode+'\n'+stamp+'\n'+raw));
 return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function same(row,b){
 return !!row&&keys.every(k=>row[k]===b[k]);
}
export async function recurringFinanceReservationRoute(request,env,mode){
 if(env.APP_ENV!=='production'||env.APPROVALS_ENABLED!=='true'||
  env.RECURRING_FINANCE_AUTH_ENABLED!=='true'||
  env.RECURRING_FINANCE_RESERVATIONS_ENABLED!=='true'||
  !h64.test(env.RECURRING_FINANCE_RESERVATION_SECRET||'')||!env.DB?.prepare)
  return deny('recurring_reservation_disabled',503);
 if(!['reserve','receipt'].includes(mode)||request.method!=='POST'||
  request.headers.has('origin')||request.headers.has('cookie')||
  request.headers.has('authorization')||
  request.headers.get('x-approval-client')!=='kakeibo-recurring-finance'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('backend_only',403);
 const stamp=request.headers.get('x-approval-timestamp')||'',
  sig=request.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||!h64.test(sig))
  return deny('recurring_reservation_signature_invalid',403);
 let b,raw;
 try{raw=await request.text();if(raw.length>1500)return deny('invalid_body',400);b=JSON.parse(raw)}
 catch{return deny('invalid_body',400)}
 if(!exact(b,keys)||!id32.test(b.occurrence_id)||!uuid.test(b.policy_id)||
  !id32.test(b.plan_resource_id)||!h64.test(b.plan_payload_sha256)||
  !h64.test(b.entry_intent_sha256)||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.member_user_id!=='string'||!b.member_user_id||b.member_user_id.length>128||
  !Number.isSafeInteger(b.source_account_version)||b.source_account_version<1||
  !Number.isSafeInteger(b.amount_jpy)||b.amount_jpy<1||b.amount_jpy>10000000||
  !month(b.period_key)||!date(b.due_date)||b.period_key!==b.due_date.slice(0,7))
  return deny('recurring_reservation_invalid_terms',400);
 const verified=await sign(env.RECURRING_FINANCE_RESERVATION_SECRET,mode,stamp,raw);
 if(!constantEqualHex(verified,sig.toLowerCase()))return deny('invalid_signature',403);
 const db=env.DB;
 const byId=()=>db.prepare('SELECT * FROM household_recurring_finance_reservations '+
  'WHERE occurrence_id=? LIMIT 1').bind(b.occurrence_id).first();
 const saved=await byId();
 if(saved)return same(saved,b)?response(saved,true):deny('recurring_occurrence_idempotency_conflict');
 if(mode==='receipt')return deny('recurring_occurrence_unknown',404);
 try{
  const result=await db.prepare('INSERT INTO household_recurring_finance_reservations '+
   '(occurrence_id,policy_id,household_id,member_user_id,plan_resource_id,'+
   'plan_payload_sha256,source_account_version,period_key,due_date,amount_jpy,'+
   'entry_intent_sha256,reserved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(b.occurrence_id,b.policy_id,b.household_id,b.member_user_id,
    b.plan_resource_id,b.plan_payload_sha256,b.source_account_version,
    b.period_key,b.due_date,b.amount_jpy,b.entry_intent_sha256,nowMs()).run();
  if(result.meta?.changes!==1)return deny('recurring_reservation_not_confirmed',503);
  const committed=await byId();
  return same(committed,b)?response(committed,false):
   deny('recurring_reservation_missing_receipt',503);
 }catch{
  const raced=await byId().catch(()=>null);
  return same(raced,b)?response(raced,true):deny('recurring_reservation_guard_failed');
 }
}
