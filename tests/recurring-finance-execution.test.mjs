import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {createHmac,webcrypto} from 'node:crypto'
import {recurringFinancePoliciesRoute} from '../worker/recurring-finance-policies.js'
import {recurringFinanceReservationRoute} from '../worker/recurring-finance-reservations.js'
import {recurringFinanceExecutionRoute} from '../worker/recurring-finance-execution.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const home='https://homeflow.test',member={household_id:'primary',user_id:'member',role:'member'}
const owner={household_id:'primary',user_id:'owner',role:'owner'}
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const due=()=>Math.min(Number(today().slice(-2)),28)
const month=()=>today().slice(0,7)
const sha='d'.repeat(64),plan='c'.repeat(32)
const keys=['occurrence_id','policy_id','household_id','member_user_id','plan_resource_id','plan_payload_sha256','source_account_version','period_key','due_date','amount_jpy','entry_intent_sha256']
const secrets={reserve:'a'.repeat(64),proof:'b'.repeat(64),record:'c'.repeat(64),read:'e'.repeat(64)}
const mac=(s,domain,stamp,raw)=>createHmac('sha256',Buffer.from(s,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex')
function setup(){
 const sql=new DatabaseSync(':memory:')
 sql.exec("PRAGMA foreign_keys=ON; CREATE TABLE households(id TEXT PRIMARY KEY); "+
  "CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER); "+
  "CREATE TABLE household_members(household_id TEXT REFERENCES households(id),user_id TEXT REFERENCES users(id),role TEXT,PRIMARY KEY(household_id,user_id)); "+
  "INSERT INTO households VALUES('primary');"+
  "INSERT INTO users VALUES('member',NULL),('owner',NULL);"+
  "INSERT INTO household_members VALUES('primary','member','member'),('primary','owner','owner');")
 for(const p of ['0059_recurring_financial_authorizations.sql','0060_recurring_execution_receipts.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+p,import.meta.url),'utf8'))
 const db={prepare(q){return{bind(...a){return{
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})
 }}}}}
 const env={APP_ENV:'production',DB:db,APPROVALS_ENABLED:'true',
  RECURRING_FINANCE_AUTH_ENABLED:'true',RECURRING_FINANCE_RESERVATIONS_ENABLED:'true',
  RECURRING_FINANCE_RESERVATION_SECRET:secrets.reserve,
  RECURRING_FINANCE_EXECUTION_PROOF_ENABLED:'true',
  RECURRING_FINANCE_EXECUTION_PROOF_SECRET:secrets.proof,
  RECURRING_FINANCE_EXECUTION_RECORD_SECRET:secrets.record,
  RECURRING_FINANCE_KAKEIBO_RECEIPT_SECRET:secrets.read}
 let failRead=false,readCount=0
 env.KAKEIBO_RECURRING_RECEIPT_SERVICE={async fetch(req){
  readCount++
  const t=req.headers.get('x-approval-timestamp'),raw=await req.text(),body=JSON.parse(raw)
  assert.equal(req.headers.get('x-approval-client'),'homeflow-recurring-finance')
  assert.equal(req.headers.get('x-approval-signature'),
   mac(secrets.read,'homeflow:recurring-finance-receipt',t,raw))
  if(failRead)return Response.json({ok:false},{status:503})
  return Response.json({ok:true,applied:true,...body,
   target_journal_sha256:'f'.repeat(64),target_entry_id:13,
   target_plan_type:'fixed_cost',target_applied_at:sql.prepare('SELECT reserved_at FROM household_recurring_finance_reservations WHERE occurrence_id=?').get(body.occurrence_id).reserved_at,
   owner_authorizer_user_id:'owner',
   external_bank_verified:false,external_broker_verified:false})
 }}
 const root='/api/recurring-finance/policies'
 async function policy(path,user,b){
  const req=new Request(home+path,{method:'POST',
   headers:{'content-type':'application/json',origin:home},body:JSON.stringify(b)})
  const r=await recurringFinancePoliciesRoute(req,env,path,user)
  return {status:r.status,data:await r.json()}
 }
 async function signed(mode,data,opt={}){
  const raw=JSON.stringify(data),stamp=String(Date.now())
  const s=secrets[mode==='execution-proof'?'proof':mode==='record'?'record':'reserve']
  const domain='kakeibo-recurring-finance:'+mode
  const req=new Request(home+'/api/internal/recurring-finance/'+mode,{method:'POST',
   headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-recurring-finance',
    'x-approval-timestamp':stamp,'x-approval-signature':opt.bad?'0'.repeat(64):mac(s,domain,stamp,raw),
    ...(opt.origin?{origin:home}:{})},body:raw})
  const result=mode==='reserve'?await recurringFinanceReservationRoute(req,env,mode):
   await recurringFinanceExecutionRoute(req,env,mode)
  return {status:result.status,data:await result.json()}
 }
 async function prepare(){
  const p=await policy(root,member,{
   expected_user_id:member.user_id,plan_resource_id:plan,plan_payload_sha256:sha,
   plan_type:'fixed_cost',source_account_version:1,due_day:due(),
   max_amount_jpy:5000,start_month:month(),end_month:month(),
   idempotency_key:'stable-recurring-policy-20261115'})
  assert.equal(p.status,201,JSON.stringify(p))
  const id=p.data.policy.policy_id
  const a=await policy(root+'/'+id+'/review',owner,{
   expected_user_id:owner.user_id,expected_version:1,decision:'approve'})
  assert.equal(a.status,200,JSON.stringify(a))
  const body={occurrence_id:'a'.repeat(32),policy_id:id,household_id:'primary',
   member_user_id:'member',plan_resource_id:plan,plan_payload_sha256:sha,
   source_account_version:1,period_key:month(),
   due_date:month()+'-'+String(due()).padStart(2,'0'),amount_jpy:1500,
   entry_intent_sha256:'9'.repeat(64)}
  return body
 }
 async function reserve(b){return signed('reserve',b)}
 const receipt=b=>({...b,target_journal_sha256:'f'.repeat(64),target_entry_id:13,
  target_plan_type:'fixed_cost',target_applied_at:sql.prepare('SELECT reserved_at FROM household_recurring_finance_reservations WHERE occurrence_id=?').get(b.occurrence_id).reserved_at,
  owner_authorizer_user_id:'owner',external_bank_verified:false,external_broker_verified:false})
 const count=t=>sql.prepare('SELECT COUNT(*) n FROM '+t).get().n
 return {sql,env,policy,prepare,reserve,signed,receipt,count,
  failRead(){failRead=true},restoreRead(){failRead=false},
  get reads(){return readCount},close(){sql.close()}}
}
test('real owner-reviewed HomeFlow monthly reservation grants bounded execution proof, never declares ledger applied',async()=>{
 const f=setup()
 try{
  const b=await f.prepare()
  const before=await f.signed('execution-proof',b)
  assert.equal(before.status,409)
  assert.equal((await f.reserve(b)).status,200)
  const proof=await f.signed('execution-proof',b)
  assert.equal(proof.status,200,JSON.stringify(proof))
  assert.equal(proof.data.execution_permitted,true)
  assert.equal(proof.data.ledger_applied,false)
  assert.equal(proof.data.owner_authorizer_user_id,'owner')
  assert.equal(proof.data.bank_statements_verified_by_institution,false)
  assert.equal(f.count('household_recurring_execution_receipts'),0)
  assert.equal((await f.signed('execution-proof',b,{bad:true})).status,403)
  assert.equal((await f.signed('execution-proof',b,{origin:true})).status,403)
 }finally{f.close()}
})
test('independent Kakeibo original journal readback is required for immutable HomeFlow execution receipt; duplicate record is idempotent',async()=>{
 const f=setup()
 try{
  const b=await f.prepare()
  assert.equal((await f.reserve(b)).status,200)
  const receipt=f.receipt(b)
  f.failRead()
  const refused=await f.signed('record',receipt)
  assert.equal(refused.status,503,JSON.stringify(refused))
  assert.equal(f.count('household_recurring_execution_receipts'),0)
  f.restoreRead()
  const applied=await f.signed('record',receipt)
  assert.equal(applied.status,200,JSON.stringify(applied))
  assert.equal(applied.data.ledger_applied,true)
  assert.equal(applied.data.external_bank_verified,false)
  assert.equal(applied.data.external_broker_verified,false)
  assert.equal(f.count('household_recurring_execution_receipts'),1)
  assert.equal(f.count('household_recurring_execution_events'),1)
  const retry=await f.signed('record',receipt)
  assert.equal(retry.status,200)
  assert.equal(retry.data.replayed,true)
  assert.equal(f.count('household_recurring_execution_receipts'),1)
  assert.throws(()=>f.sql.prepare('UPDATE household_recurring_execution_receipts SET amount_jpy=9').run(),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare('DELETE FROM household_recurring_execution_events').run(),/IMMUTABLE/)
  assert.equal((await f.signed('execution-proof',b)).status,409,'never execute an already applied month')
  assert.equal((await f.signed('record',{...receipt,target_entry_id:999})).status,409)
 }finally{f.close()}
})
test('revoke, disabled member, mismatched amount or evidence attestation never grant executable standing authority',async()=>{
 for(const failure of ['revoke','disable','amount','broker_claim']){
  const f=setup()
  try{
   const b=await f.prepare()
   assert.equal((await f.reserve(b)).status,200)
   if(failure==='revoke'){
    const p=f.sql.prepare('SELECT version FROM household_recurring_finance_policies').get()
    const r=await f.policy('/api/recurring-finance/policies/'+b.policy_id+'/revoke',member,{
     expected_user_id:'member',expected_version:p.version})
    assert.equal(r.status,200)
   }
   if(failure==='disable')
    f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('member')
   if(failure==='amount')b.amount_jpy=9000
   if(failure==='broker_claim'){
    const fake={...f.receipt(b),external_broker_verified:true}
    assert.equal((await f.signed('record',fake)).status,403)
   }else assert.notEqual((await f.signed('execution-proof',b)).status,200)
  }finally{f.close()}
 }
})
