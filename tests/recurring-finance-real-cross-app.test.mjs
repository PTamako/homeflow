import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto} from 'node:crypto'
import {recurringFinancePolicySubmissionRoute} from '../worker/recurring-finance-policy-submission.js'
import {recurringFinancePoliciesRoute} from '../worker/recurring-finance-policies.js'
import {recurringFinanceReservationRoute} from '../worker/recurring-finance-reservations.js'
import {recurringFinanceExecutionRoute} from '../worker/recurring-finance-execution.js'
import {familyMemberRecurringPlans} from '../.contract-kakeibo/functions/api/family-finance/member-recurring-plans.js'
import {familyRecurringOccurrences} from '../.contract-kakeibo/functions/api/family-finance/recurring-occurrences.js'
import {recurringFinanceIndependentReceipt} from '../.contract-kakeibo/functions/api/internal/recurring-finance/receipt.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const member='22222222-2222-4222-8222-222222222222'
const owner='11111111-1111-4111-8111-111111111111',hh='primary'
const bank='b'.repeat(32),securities='c'.repeat(32)
const home='https://homeflow.test',kakeibo=new URL('https://kakeibo.test/api/family-finance/member-recurring-plans')
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const s={policy:'1'.repeat(64),reserve:'2'.repeat(64),proof:'3'.repeat(64),
 record:'4'.repeat(64),receipt:'5'.repeat(64),sealed:'6'.repeat(64)}
function db(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('PRAGMA foreign_keys=ON')
 const binding={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(stmts){sql.exec('BEGIN IMMEDIATE');try{
  const out=stmts.map(x=>x.sync());sql.exec('COMMIT');return out
 }catch(e){sql.exec('ROLLBACK');throw e}}}
 return {sql,binding}
}
function fixture(){
 const h=db(),k=db()
 h.sql.exec("CREATE TABLE households(id TEXT PRIMARY KEY);"+
  "CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);"+
  "CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT,PRIMARY KEY(household_id,user_id));")
 h.sql.prepare('INSERT INTO households VALUES(?)').run(hh)
 for(const [u,role] of [[owner,'owner'],[member,'member']]){
  h.sql.prepare('INSERT INTO users VALUES(?,NULL)').run(u)
  h.sql.prepare('INSERT INTO household_members VALUES(?,?,?)').run(hh,u,role)
 }
 for(const f of ['0059_recurring_financial_authorizations.sql','0060_recurring_execution_receipts.sql'])
  h.sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'))
 for(const f of ['schema.sql','migrations/0001_support_tables.sql',
  'migrations/0002_versioned_migration_tracking.sql','migrations/0022_homeflow_identity_foundation.sql',
  'migrations/0023_family_financial_account_identities.sql'])
  k.sql.exec(readFileSync(new URL('../.contract-kakeibo/'+f,import.meta.url),'utf8'))
 k.sql.exec('ALTER TABLE entries ADD COLUMN family_account_id TEXT')
 k.sql.exec('ALTER TABLE entries ADD COLUMN family_transfer_target_account_id TEXT')
 k.sql.exec('CREATE TABLE family_sbi_cash_bank_evidence(bank_account_id TEXT,reference_hash TEXT)')
 k.sql.exec('CREATE TABLE family_card_bank_debit_evidence(bank_account_id TEXT,reference_hash TEXT)')
 k.sql.exec('CREATE TABLE family_sbi_cash_refund_evidence(bank_account_id TEXT,bank_refund_hash TEXT)')
 k.sql.exec('CREATE TABLE family_bank_transfer_posted_evidence(source_account_id TEXT,source_reference_hash TEXT,target_account_id TEXT,target_reference_hash TEXT)')
 k.sql.exec('CREATE TABLE family_cross_bank_journal(source_account_id TEXT,source_reference_hash TEXT,target_account_id TEXT,credit_reference_hash TEXT)')
 k.sql.exec('CREATE TABLE family_sbi_cash_lots(broker_reference_hash TEXT)')
 k.sql.exec('CREATE TABLE family_sbi_point_lots(broker_reference_hash TEXT)')
 for(const f of ['0053_member_recurring_finance_plans.sql','0054_recurring_finance_ledger_execution.sql'])
  k.sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+f,import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  k.sql.prepare("INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)")
   .run(u,hh,role,role,'active',Date.now())
 for(const [a,kind] of [[bank,'bank'],[securities,'securities']])
  k.sql.prepare('INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(a,hh,member,kind,kind,'member_created',100000,member,member)
 const he={APP_ENV:'production',APPROVALS_ENABLED:'true',DB:h.binding,
  RECURRING_FINANCE_AUTH_ENABLED:'true',RECURRING_FINANCE_RESERVATIONS_ENABLED:'true',
  RECURRING_FINANCE_POLICY_SUBMISSION_ENABLED:'true',
  RECURRING_FINANCE_POLICY_SUBMISSION_SECRET:s.policy,
  RECURRING_FINANCE_RESERVATION_SECRET:s.reserve,
  RECURRING_FINANCE_EXECUTION_PROOF_ENABLED:'true',
  RECURRING_FINANCE_EXECUTION_PROOF_SECRET:s.proof,
  RECURRING_FINANCE_EXECUTION_RECORD_SECRET:s.record,
  RECURRING_FINANCE_KAKEIBO_RECEIPT_SECRET:s.receipt}
 const ke={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',DB:k.binding,
  KAKEIBO_RECURRING_FINANCE_PLANS_ENABLED:'true',KAKEIBO_RECURRING_EXECUTION_ENABLED:'true',
  KAKEIBO_RECURRING_POLICY_SUBMISSION_ENABLED:'true',
  KAKEIBO_RECURRING_POLICY_SUBMISSION_SECRET:s.policy,
  KAKEIBO_RECURRING_PAYLOAD_KEY:s.sealed,
  KAKEIBO_RECURRING_HOMEFLOW_RESERVATION_SECRET:s.reserve,
  KAKEIBO_RECURRING_HOMEFLOW_PROOF_SECRET:s.proof,
  KAKEIBO_RECURRING_HOMEFLOW_RECORD_SECRET:s.record,
  KAKEIBO_RECURRING_RECEIPT_SECRET:s.receipt,
  HOMEFLOW_OAUTH_ORIGIN:home}
 let loseRecord=false,readCount=0,proofCount=0
 ke.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const name=new URL(req.url).pathname.split('/').at(-1)
  if(name==='policy-submit')return recurringFinancePolicySubmissionRoute(req,he)
  if(name==='reserve'||name==='receipt')
   return recurringFinanceReservationRoute(req,he,name)
  if(name==='execution-proof'||name==='record'){
   if(name==='record'&&loseRecord)return Response.json({ok:false},{status:503})
   if(name==='execution-proof')proofCount++
   return recurringFinanceExecutionRoute(req,he,name)
  }
  return Response.json({ok:false},{status:404})
 }}
 he.KAKEIBO_RECURRING_RECEIPT_SERVICE={async fetch(req){
  readCount++
  return recurringFinanceIndependentReceipt(req,ke)
 }}
 const user={user_id:member,household_id:hh,role:'member'}
 const ownerUser={user_id:owner,household_id:hh,role:'owner'}
 async function kcall(handler,parts,data){
  const req=new Request(kakeibo,{method:'POST',headers:{
   origin:kakeibo.origin,'content-type':'application/json'},body:JSON.stringify(data)})
  const r=await handler(req,ke,kakeibo,user,parts)
  return {status:r.status,data:await r.json()}
 }
 async function plan(type){
  const date=today(),period=date.slice(0,7)
  const form={expected_user_id:member,idempotency_key:'cross-real-plan-'+type+'-'+period,
   plan_type:type,source_bank_account_id:bank,source_account_version:1,
   securities_account_id:type==='sbi_tsumitate'?securities:null,
   securities_version:type==='sbi_tsumitate'?1:null,
   amount_jpy:type==='fixed_cost'?5000:15000,
   due_day:Math.min(28,Number(date.slice(-2))),start_month:period,end_month:period,
   category:type==='fixed_cost'?'住居':'積立',merchant:type==='fixed_cost'?'家賃':'SBI証券',
   fund_code:type==='fixed_cost'?null:'12345678',
   fund_name:type==='fixed_cost'?null:'Index Fund',
   account_type:type==='fixed_cost'?null:'tsumitate'}
  const p=await kcall(familyMemberRecurringPlans,['member-recurring-plans'],form)
  assert.equal(p.status,201,JSON.stringify(p))
  const id=p.data.plan.plan_resource_id
  const proposal=await kcall(familyMemberRecurringPlans,
   ['member-recurring-plans',id,'submit-policy'],
   {expected_user_id:member,confirm_plan_resource_id:id})
  assert.equal(proposal.status,201,JSON.stringify(proposal))
  assert.equal(proposal.data.owner_approved,false)
  return proposal.data.policy
 }
 async function review(p){
  const route='/api/recurring-finance/policies/'+p.policy_id+'/review'
  const req=new Request(home+route,{method:'POST',
   headers:{'content-type':'application/json',origin:home},
   body:JSON.stringify({expected_user_id:owner,expected_version:1,decision:'approve'})})
  const r=await recurringFinancePoliciesRoute(req,he,route,ownerUser)
  return {status:r.status,data:await r.json()}
 }
 async function occurrence(p,type){
  const date=today(),reference='real-cross-bank-'+type
  const data={expected_user_id:member,policy_id:p.policy_id,
   plan_resource_id:p.plan_resource_id,period_key:date.slice(0,7),
   debit_date:date,bank_reference:reference,bank_debit_posted:true,
   confirmed_units:type==='sbi_tsumitate'?190000:null,
   broker_trade_reference:type==='sbi_tsumitate'?'real-cross-sbi-trade':null,
   trade_date:type==='sbi_tsumitate'?date:null,
   effective_date:type==='sbi_tsumitate'?date:null,
   broker_order_executed:type==='sbi_tsumitate'}
  const r=await kcall(familyRecurringOccurrences,['recurring-occurrences'],data)
  assert.equal(r.status,201,JSON.stringify(r))
  return r.data.prepared
 }
 async function execute(id){
  return kcall(familyRecurringOccurrences,['recurring-occurrences',id,'execute'],
   {expected_user_id:member,confirm_occurrence_id:id})
 }
 const count=(where,t)=>where.sql.prepare('SELECT COUNT(*) n FROM '+t).get().n
 return {h,k,he,ke,plan,review,occurrence,execute,kcall,count,
  lose(){loseRecord=true},restore(){loseRecord=false},
  get reads(){return readCount},get proofs(){return proofCount},
  close(){h.sql.close();k.sql.close()}}
}
for(const type of ['fixed_cost','sbi_tsumitate']){
 test('real two independent D1 databases: actual HomeFlow owner review -> immutable Kakeibo monthly '+type+' -> H journal proof',async()=>{
  const f=fixture()
  try{
   const p=await f.plan(type)
   const occurrence=await f.occurrence(p,type)
   assert.equal((await f.execute(occurrence.occurrence_id)).status,503,'unapproved policy cannot reserve')
   assert.equal(f.count(f.k,'entries'),0)
   assert.equal(f.count(f.h,'household_recurring_finance_reservations'),0)
   assert.equal((await f.review(p)).status,200)
   const posted=await f.execute(occurrence.occurrence_id)
   assert.equal(posted.status,200,JSON.stringify(posted))
   assert.equal(posted.data.homeflow_receipt_confirmed,true)
   assert.equal(f.count(f.k,'entries'),1)
   assert.equal(f.count(f.k,'family_recurring_execution_applied'),1)
   assert.equal(f.count(f.h,'household_recurring_finance_reservations'),1)
   assert.equal(f.count(f.h,'household_recurring_execution_receipts'),1)
   assert.equal(f.count(f.h,'household_recurring_execution_events'),1)
   assert.equal(f.count(f.k,'family_recurring_execution_audit'),1)
   assert.equal(f.count(f.k,'family_recurring_sbi_lots'),type==='sbi_tsumitate'?1:0)
   assert.equal(f.reads,1)
   const replay=await f.execute(occurrence.occurrence_id)
   assert.equal(replay.status,200,JSON.stringify(replay))
   assert.equal(replay.data.already_applied,true)
   assert.equal(f.count(f.k,'entries'),1)
  }finally{f.close()}
 })
}
test('cross-D1 HomeFlow receipt network loss after Kakeibo commit reconciles original month without duplicate debit',async()=>{
 const f=fixture()
 try{
  const p=await f.plan('sbi_tsumitate')
  assert.equal((await f.review(p)).status,200)
  const o=await f.occurrence(p,'sbi_tsumitate')
  f.lose()
  const unknown=await f.execute(o.occurrence_id)
  assert.equal(unknown.status,202,JSON.stringify(unknown))
  assert.equal(f.count(f.k,'entries'),1)
  assert.equal(f.count(f.h,'household_recurring_execution_receipts'),0)
  f.restore()
  const restored=await f.execute(o.occurrence_id)
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(restored.data.already_applied,true)
  assert.equal(f.count(f.k,'entries'),1)
  assert.equal(f.count(f.h,'household_recurring_execution_receipts'),1)
 }finally{f.close()}
})
test('revoked HomeFlow owner authorization and revoked Kakeibo member refuse actual recurring debit',async()=>{
 for(const what of ['policy','identity']){
  const f=fixture()
  try{
   const p=await f.plan('fixed_cost')
   assert.equal((await f.review(p)).status,200)
   const o=await f.occurrence(p,'fixed_cost')
   if(what==='policy'){
    const route='/api/recurring-finance/policies/'+p.policy_id+'/revoke'
    const req=new Request(home+route,{method:'POST',
     headers:{origin:home,'content-type':'application/json'},
     body:JSON.stringify({expected_user_id:member,expected_version:2})})
    const rev=await recurringFinancePoliciesRoute(req,f.he,route,
     {user_id:member,household_id:hh,role:'member'})
    assert.equal(rev.status,200)
   }else f.k.sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(member)
   assert.notEqual((await f.execute(o.occurrence_id)).status,200)
   assert.equal(f.count(f.k,'entries'),0)
  }finally{f.close()}
 }
})
