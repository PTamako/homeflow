// Server-to-server recurring finance authority + independent target receipt.
// Existing HomeFlow §93 owner-approved policy and unique monthly reservation are
// authoritative. No Cron or broker/bank API is invoked here; proof is NOT paid.
import {json,nowMs,constantEqualHex} from './security.js'
const enc=new TextEncoder(),h64=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const deny=(code,status=409)=>json({ok:false,code,ledger_applied:false},status)
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',')
const reserve=['occurrence_id','policy_id','household_id','member_user_id','plan_resource_id',
 'plan_payload_sha256','source_account_version','period_key','due_date','amount_jpy',
 'entry_intent_sha256']
const applied=[...reserve,'target_journal_sha256','target_entry_id','target_plan_type',
 'target_applied_at','owner_authorizer_user_id','external_bank_verified',
 'external_broker_verified']
const valid=x=>id32.test(x?.occurrence_id)&&uuid.test(x?.policy_id)&&
 id32.test(x?.plan_resource_id)&&h64.test(x?.plan_payload_sha256)&&
 h64.test(x?.entry_intent_sha256)&&
 typeof x.household_id==='string'&&x.household_id.length>0&&x.household_id.length<=128&&
 typeof x.member_user_id==='string'&&x.member_user_id.length>0&&
 x.member_user_id.length<=128&&
 Number.isSafeInteger(x.source_account_version)&&x.source_account_version>=1&&
 Number.isSafeInteger(x.amount_jpy)&&x.amount_jpy>=1&&x.amount_jpy<=10000000&&
 typeof x.period_key==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(x.period_key)&&
 typeof x.due_date==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x.due_date)&&
 new Date(x.due_date+'T00:00:00Z').toISOString().slice(0,10)===x.due_date&&
 x.period_key===x.due_date.slice(0,7)
const ready=e=>e.APP_ENV==='production'&&e.APPROVALS_ENABLED==='true'&&
 e.RECURRING_FINANCE_AUTH_ENABLED==='true'&&
 e.RECURRING_FINANCE_RESERVATIONS_ENABLED==='true'&&
 e.RECURRING_FINANCE_EXECUTION_PROOF_ENABLED==='true'&&
 h64.test(e.RECURRING_FINANCE_EXECUTION_PROOF_SECRET||'')&&
 h64.test(e.RECURRING_FINANCE_EXECUTION_RECORD_SECRET||'')&&e.DB?.prepare;
async function sign(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),
  v=>parseInt(v,16)),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode(domain+'\n'+stamp+'\n'+raw)))].map(x=>x.toString(16).padStart(2,'0')).join('')
}
async function signed(request,e,mode){
 if(request.method!=='POST'||request.headers.has('origin')||
  request.headers.has('cookie')||request.headers.has('authorization')||
  request.headers.get('x-approval-client')!=='kakeibo-recurring-finance'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null
 const stamp=request.headers.get('x-approval-timestamp')||'',signature=request.headers.get('x-approval-signature')||''
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !h64.test(signature))return null
 let x,raw
 try{raw=await request.text();x=raw.length<=1900?JSON.parse(raw):null}catch{return null}
 if(!exact(x,mode==='execution-proof'?reserve:applied)||!valid(x))return null
 if(mode==='record'&&(!h64.test(x.target_journal_sha256)||
  !Number.isSafeInteger(x.target_entry_id)||x.target_entry_id<1||
  !['fixed_cost','sbi_tsumitate'].includes(x.target_plan_type)||
  typeof x.owner_authorizer_user_id!=='string'||!x.owner_authorizer_user_id||
  x.owner_authorizer_user_id.length>128||
  !Number.isSafeInteger(x.target_applied_at)||x.target_applied_at<1||
  x.external_bank_verified!==false||x.external_broker_verified!==false))
  return null
 const secret=mode==='record'?e.RECURRING_FINANCE_EXECUTION_RECORD_SECRET:
  e.RECURRING_FINANCE_EXECUTION_PROOF_SECRET
 const computed=await sign(secret,'kakeibo-recurring-finance:'+mode,stamp,raw)
 return constantEqualHex(computed,signature.toLowerCase())?x:null
}
async function context(db,x){
 return db.prepare('SELECT r.*,p.plan_type,p.status AS policy_status,p.owner_user_id,'+
  'p.owner_reviewed_at,p.updated_at AS policy_updated_at,p.due_day,p.max_amount_jpy,'+
  'm.role AS member_role,mu.disabled_at AS member_disabled,'+
  'o.role AS owner_role,ou.disabled_at AS owner_disabled '+
  'FROM household_recurring_finance_reservations r '+
  'JOIN household_recurring_finance_policies p ON p.policy_id=r.policy_id '+
  'LEFT JOIN household_members m ON m.household_id=r.household_id AND m.user_id=r.member_user_id '+
  'LEFT JOIN users mu ON mu.id=r.member_user_id '+
  'LEFT JOIN household_members o ON o.household_id=r.household_id AND o.user_id=p.owner_user_id '+
  'LEFT JOIN users ou ON ou.id=p.owner_user_id '+
  'WHERE r.occurrence_id=? LIMIT 1').bind(x.occurrence_id).first()
}
const same=(r,x)=>r&&reserve.every(k=>r[k]===x[k])
async function proof(e,x){
 const r=await context(e.DB,x)
 if(!same(r,x)||r.policy_status!=='approved'||
  r.member_role!=='member'||r.member_disabled!=null||
  r.owner_role!=='owner'||r.owner_disabled!=null||
  r.owner_reviewed_at==null||r.owner_reviewed_at>r.reserved_at||
  r.due_date!==r.period_key+'-'+String(r.due_day).padStart(2,'0')||
  r.amount_jpy>r.max_amount_jpy||
  nowMs()>Date.parse(r.due_date+'T23:59:59+09:00')+7*86400000||
  !['fixed_cost','sbi_tsumitate'].includes(r.plan_type))
  return deny('recurring_policy_not_current',409)
 // Prohibit new financial mutation for already journaled occurrence.
 const old=await e.DB.prepare('SELECT occurrence_id FROM household_recurring_execution_receipts '+
  'WHERE occurrence_id=? LIMIT 1').bind(x.occurrence_id).first()
 if(old)return deny('recurring_occurrence_already_applied',409)
 const stamp=nowMs()
 return json({ok:true,execution_permitted:true,ledger_applied:false,
  ...Object.fromEntries(reserve.map(k=>[k,r[k]])),
  plan_type:r.plan_type,owner_authorizer_user_id:r.owner_user_id,
  bank_statements_verified_by_institution:false,
  broker_transactions_verified_by_institution:false,
  scope:'standing_owner_approved_per_month_internal_ledger',
  proof_expires_at:stamp+20000})
}
const receiptFields=[...reserve,'target_journal_sha256','target_entry_id',
 'target_plan_type','target_applied_at','owner_authorizer_user_id',
 'external_bank_verified','external_broker_verified']
const matchesSaved=(r,x)=>!!r&&reserve.every(k=>r[k]===x[k])&&
 receiptFields.every(k=>k.startsWith('external_')?
  r[k]===0&&x[k]===false:r[k]===x[k])
async function receiptFromTarget(e,x){
 if(typeof e.KAKEIBO_RECURRING_RECEIPT_SERVICE?.fetch!=='function'||
  !h64.test(e.RECURRING_FINANCE_KAKEIBO_RECEIPT_SECRET||''))
  return null
 const body={...Object.fromEntries(reserve.map(k=>[k,x[k]]))},
  raw=JSON.stringify(body),stamp=String(nowMs())
 const request=new Request('https://kakeibo.internal/api/internal/recurring-finance/receipt',{
  method:'POST',redirect:'manual',headers:{'content-type':'application/json',
   'x-approval-client':'homeflow-recurring-finance',
   'x-approval-timestamp':stamp,
   'x-approval-signature':await sign(e.RECURRING_FINANCE_KAKEIBO_RECEIPT_SECRET,
    'homeflow:recurring-finance-receipt',stamp,raw)},body:raw})
 try{
  const response=await e.KAKEIBO_RECURRING_RECEIPT_SERVICE.fetch(request)
  if(response.status!==200||response.headers.has('location'))return null
  const t=await response.text();if(t.length>2400)return null
  const result=JSON.parse(t)
  return result?.ok===true&&result.applied===true&&
   reserve.every(k=>result[k]===x[k])&&
   receiptFields.every(k=>result[k]===x[k])?result:null
 }catch{return null}
}
const visible=(r,replayed)=>({ok:true,ledger_applied:true,applied:true,
 occurrence_id:r.occurrence_id,policy_id:r.policy_id,
 household_id:r.household_id,member_user_id:r.member_user_id,
 plan_resource_id:r.plan_resource_id,plan_payload_sha256:r.plan_payload_sha256,
 source_account_version:r.source_account_version,period_key:r.period_key,
 due_date:r.due_date,amount_jpy:r.amount_jpy,
 entry_intent_sha256:r.entry_intent_sha256,
 target_journal_sha256:r.target_journal_sha256,
 target_entry_id:r.target_entry_id,target_plan_type:r.target_plan_type,
 target_applied_at:r.target_applied_at,
 owner_authorizer_user_id:r.owner_authorizer_user_id,
 external_bank_verified:false,external_broker_verified:false,replayed})
async function record(e,x){
 const prior=await e.DB.prepare('SELECT * FROM household_recurring_execution_receipts WHERE occurrence_id=?')
  .bind(x.occurrence_id).first()
 if(prior)return matchesSaved(prior,x)?json(visible(prior,true)):
  deny('recurring_receipt_idempotency_conflict')
 const r=await context(e.DB,x)
 if(!same(r,x)||r.plan_type!==x.target_plan_type||
  r.owner_user_id!==x.owner_authorizer_user_id||
  r.owner_reviewed_at==null||r.owner_reviewed_at>x.target_applied_at||
  !['approved','revoked'].includes(r.policy_status)||
  (r.policy_status==='revoked'&&x.target_applied_at>r.policy_updated_at)||
  r.reserved_at>x.target_applied_at||x.target_applied_at>nowMs()+30000)
  return deny('recurring_policy_or_time_mismatch')
 // A signed Kakeibo body is not enough: HomeFlow performs an independent
 // read-only GET of the original target journal through its own Service Binding.
 const target=await receiptFromTarget(e,x)
 if(!target)return deny('recurring_target_receipt_independent_read_failed',503)
 const at=nowMs()
 try{
  const result=await e.DB.prepare('INSERT INTO household_recurring_execution_receipts '+
   '(occurrence_id,policy_id,household_id,member_user_id,owner_authorizer_user_id,'+
   'plan_resource_id,plan_payload_sha256,source_account_version,period_key,due_date,'+
   'amount_jpy,entry_intent_sha256,target_journal_sha256,target_entry_id,target_plan_type,'+
   'target_applied_at,received_at,target_receipt_verified,external_bank_verified,external_broker_verified) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0)')
   .bind(x.occurrence_id,x.policy_id,x.household_id,x.member_user_id,
    x.owner_authorizer_user_id,x.plan_resource_id,x.plan_payload_sha256,
    x.source_account_version,x.period_key,x.due_date,x.amount_jpy,
    x.entry_intent_sha256,x.target_journal_sha256,x.target_entry_id,
    x.target_plan_type,x.target_applied_at,at).run()
  if(result.meta?.changes!==1)return deny('recurring_receipt_unknown',503)
  const saved=await e.DB.prepare('SELECT * FROM household_recurring_execution_receipts WHERE occurrence_id=?')
   .bind(x.occurrence_id).first()
  return saved?json(visible(saved,false)):deny('recurring_receipt_missing',503)
 }catch{
  const raced=await e.DB.prepare('SELECT * FROM household_recurring_execution_receipts WHERE occurrence_id=?')
   .bind(x.occurrence_id).first().catch(()=>null)
  return matchesSaved(raced,x)?json(visible(raced,true)):
   deny('recurring_receipt_atomic_rollback',503)
 }
}
export async function recurringFinanceExecutionRoute(request,env,mode){
 if(!ready(env))return deny('recurring_execution_proof_disabled',503)
 if(!['execution-proof','record'].includes(mode))return deny('not_found',404)
 const x=await signed(request,env,mode)
 if(!x)return deny('recurring_execution_backend_signature_required',403)
 return mode==='execution-proof'?proof(env,x):record(env,x)
}
