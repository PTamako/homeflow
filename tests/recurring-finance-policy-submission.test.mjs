import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto,createHmac} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {recurringFinancePolicySubmissionRoute} from '../worker/recurring-finance-policy-submission.js'
import {recurringFinancePoliciesRoute} from '../worker/recurring-finance-policies.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const body=()=>({household_id:'primary',requester_user_id:'member',
 plan_resource_id:'a'.repeat(32),plan_payload_sha256:'b'.repeat(64),
 plan_type:'fixed_cost',source_account_version:1,
 due_day:Math.min(28,Number(new Date(Date.now()+32400000).toISOString().slice(8,10))),
 max_amount_jpy:5000,
 start_month:new Date(Date.now()+32400000).toISOString().slice(0,7),
 end_month:new Date(Date.now()+32400000).toISOString().slice(0,7)})
const secret='c'.repeat(64),base='https://homeflow.test'
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec("PRAGMA foreign_keys=ON;"+
  "CREATE TABLE households(id TEXT PRIMARY KEY);"+
  "CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);"+
  "CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT,PRIMARY KEY(household_id,user_id));"+
  "INSERT INTO households VALUES('primary');"+
  "INSERT INTO users VALUES('owner',NULL),('member',NULL);"+
  "INSERT INTO household_members VALUES('primary','owner','owner'),('primary','member','member');")
 sql.exec(readFileSync(new URL('../migrations/0059_recurring_financial_authorizations.sql',import.meta.url),'utf8'))
 const db={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}}}
 const env={APP_ENV:'production',APPROVALS_ENABLED:'true',DB:db,
  RECURRING_FINANCE_AUTH_ENABLED:'true',RECURRING_LEGACY_OWNER_REVIEW_ENABLED:'true',
 RECURRING_FINANCE_POLICY_SUBMISSION_ENABLED:'true',
  RECURRING_FINANCE_POLICY_SUBMISSION_SECRET:secret}
 async function submit(input=body(),{wrong=false,origin=false}={}){
  const raw=JSON.stringify(input),stamp=String(Date.now())
  const signature=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('kakeibo-recurring-policy:submit\n'+stamp+'\n'+raw).digest('hex')
  const req=new Request(base+'/api/internal/recurring-finance/policy-submit',{
   method:'POST',headers:{'content-type':'application/json','x-approval-client':'kakeibo-recurring-policy',
    'x-approval-timestamp':stamp,'x-approval-signature':wrong?'0'.repeat(64):signature,
    ...(origin?{origin:base}:{})},body:raw})
  const r=await recurringFinancePolicySubmissionRoute(req,env)
  return {status:r.status,data:await r.json()}
 }
 async function review(id,user='owner'){
  const route='/api/recurring-finance/policies/'+id+'/review'
  const req=new Request(base+route,{method:'POST',headers:{'content-type':'application/json',origin:base},
   body:JSON.stringify({expected_user_id:user,expected_version:1,decision:'approve'})})
  const r=await recurringFinancePoliciesRoute(req,env,route,{user_id:user,household_id:'primary'})
  return {status:r.status,data:await r.json()}
 }
 return {sql,env,submit,review,close(){sql.close()}}
}
test('signed member Kakeibo plan becomes one owner-reviewed HomeFlow policy; replay does not create another',async()=>{
 const f=fixture()
 try{
  const m=await f.submit()
  assert.equal(m.status,201,JSON.stringify(m))
  assert.equal(m.data.owner_approved,false)
  assert.equal(m.data.ledger_applied,false)
  assert.equal(m.data.policy.status,'pending_owner')
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_recurring_finance_policies').get().n,1)
  assert.equal((await f.submit()).data.replayed,true)
  const approved=await f.review(m.data.policy.policy_id)
  assert.equal(approved.status,200,JSON.stringify(approved))
  assert.equal(approved.data.policy.status,'approved')
  assert.equal((await f.submit()).data.owner_approved,true)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_recurring_finance_events').get().n,2)
 }finally{f.close()}
})
test('no forged member identity, unsigned browser, changed immutable plan or disabled member can submit policy',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.submit(body(),{wrong:true})).status,403)
  assert.equal((await f.submit(body(),{origin:true})).status,403)
  assert.equal((await f.submit({...body(),requester_user_id:'owner'})).status,403)
  const original=await f.submit()
  assert.equal(original.status,201)
  assert.equal((await f.submit({...body(),max_amount_jpy:8000})).status,409)
  f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('member')
  assert.equal((await f.submit({...body(),plan_resource_id:'f'.repeat(32)})).status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_recurring_finance_policies').get().n,1)
 }finally{f.close()}
})
