import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto,createHmac} from 'node:crypto';
import {recurringFinancePoliciesRoute} from '../worker/recurring-finance-policies.js';
import {recurringFinanceReservationRoute} from '../worker/recurring-finance-reservations.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source={household_id:'primary',user_id:'member',role:'member'};
const owner={household_id:'primary',user_id:'owner',role:'owner'};
const spoofOwner={...source,role:'owner'};
const foreign={household_id:'second',user_id:'stranger',role:'owner'};
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const month=()=>today().slice(0,7);
const dueDay=()=>Math.min(28,Number(today().slice(8)));
const dueDate=()=>month()+'-'+String(dueDay()).padStart(2,'0');
const amount=1500,plan='c'.repeat(32),sha='d'.repeat(64);
const get=(sql,q,...args)=>sql.prepare(q).get(...args);
const count=(sql,t)=>get(sql,'SELECT COUNT(*) n FROM '+t).n;
const body=()=>({
 expected_user_id:'member',plan_resource_id:plan,plan_payload_sha256:sha,
 plan_type:'fixed_cost',source_account_version:1,due_day:dueDay(),
 max_amount_jpy:3000,start_month:month(),end_month:month(),
 idempotency_key:'monthly-policy-fixed-cost-20261115'
});
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE households(id TEXT PRIMARY KEY);
 CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  PRIMARY KEY(household_id,user_id)
 );
 INSERT INTO households VALUES('primary'),('second');
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('stranger',NULL);
 INSERT INTO household_members VALUES('primary','owner','owner'),('primary','member','member'),
 ('second','stranger','owner');`);
 sql.exec(readFileSync(new URL('../migrations/0059_recurring_financial_authorizations.sql',import.meta.url),'utf8'));
 const db={prepare(q){return {bind(...a){return {
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)}),
  run:async()=>({meta:{changes:Number(sql.prepare(q).run(...a).changes)}})
 }}}}};
 const env={APP_ENV:'production',DB:db,APPROVALS_ENABLED:'true',
  RECURRING_FINANCE_AUTH_ENABLED:'true',RECURRING_LEGACY_OWNER_REVIEW_ENABLED:'true',
  RECURRING_FINANCE_RESERVATIONS_ENABLED:'true',
  RECURRING_FINANCE_RESERVATION_SECRET:'a'.repeat(64)};
 async function policy(user,path,b,method='POST',origin='https://homeflow.example.test'){
  const req=new Request('https://homeflow.example.test'+path,{method,
   ...(method==='POST'?{headers:{'content-type':'application/json',origin},body:JSON.stringify(b)}:{})});
  const response=await recurringFinancePoliciesRoute(req,env,path,user);
  return {status:response.status,data:await response.json()};
 }
 const root='/api/recurring-finance/policies';
 const create=(user=source,input=body())=>policy(user,root,input);
 const claim=(policyId,overrides={})=>({
  occurrence_id:'b'.repeat(32),policy_id:policyId,household_id:'primary',
  member_user_id:'member',plan_resource_id:plan,plan_payload_sha256:sha,
  source_account_version:1,period_key:month(),due_date:dueDate(),
  amount_jpy:amount,entry_intent_sha256:'e'.repeat(64),...overrides
 });
 async function reserve(b,mode='reserve',{badSign=false,withOrigin=false}={}){
  const raw=JSON.stringify(b),stamp=String(Date.now());
  const hmac=createHmac('sha256',Buffer.from(env.RECURRING_FINANCE_RESERVATION_SECRET,'hex'))
   .update('kakeibo-recurring-finance:'+mode+'\n'+stamp+'\n'+raw).digest('hex');
  const headers={'content-type':'application/json',
   'x-approval-client':'kakeibo-recurring-finance','x-approval-timestamp':stamp,
   'x-approval-signature':badSign?'0'.repeat(64):hmac};
  if(withOrigin)headers.origin='https://homeflow.example.test';
  const req=new Request('https://homeflow.example.test/api/internal/recurring-finance/'+mode,{
   method:'POST',headers,body:raw});
  const res=await recurringFinanceReservationRoute(req,env,mode);
  return {status:res.status,data:await res.json()};
 }
 return {sql,db,env,policy,root,create,claim,reserve,close:()=>sql.close()};
}
test('member policy must get separate owner review, never Cron or ledger execution, immutable audit',async()=>{
 const f=fixture();try{
  const made=await f.create();
  assert.equal(made.status,201,JSON.stringify(made));
  const p=made.data.policy;
  assert.equal(p.status,'pending_owner');
  assert.equal(p.ledger_applied,false);
  assert.equal(p.cron_enabled,false);
  assert.equal(p.occurrence_execution_permitted,false);
  assert.equal(count(f.sql,'household_recurring_finance_events'),1);
  assert.equal((await f.policy(spoofOwner,f.root+'/'+p.policy_id+'/review',
   {expected_user_id:'member',expected_version:1,decision:'approve'})).status,403);
  assert.equal((await f.policy(source,f.root+'/'+p.policy_id+'/review',
   {expected_user_id:'member',expected_version:1,decision:'approve'})).status,403);
  assert.equal((await f.policy(foreign,f.root+'/'+p.policy_id+'/review',
   {expected_user_id:'stranger',expected_version:1,decision:'approve'})).status,404);
  assert.equal((await f.reserve(f.claim(p.policy_id))).status,409,
   'unapproved plan cannot reserve a financial occurrence');
  const reviewed=await f.policy(owner,f.root+'/'+p.policy_id+'/review',
   {expected_user_id:'owner',expected_version:1,decision:'approve'});
  assert.equal(reviewed.status,200,JSON.stringify(reviewed));
  assert.equal(reviewed.data.policy.status,'approved');
  assert.equal(reviewed.data.policy.version,2);
  assert.equal(reviewed.data.policy.ledger_applied,false);
  assert.equal(count(f.sql,'household_recurring_finance_events'),2);
  const repeat=await f.policy(owner,f.root+'/'+p.policy_id+'/review',
   {expected_user_id:'owner',expected_version:1,decision:'approve'});
  assert.equal(repeat.status,409);
  assert.deepEqual(f.sql.prepare('SELECT action,actor_user_id FROM household_recurring_finance_events ORDER BY new_version').all().map(x=>({...x})),[
   {action:'member_requested',actor_user_id:'member'},
   {action:'owner_approved',actor_user_id:'owner'}
  ]);
  assert.throws(()=>f.sql.prepare("UPDATE household_recurring_finance_policies SET max_amount_jpy=10000000").run(),
   /RECURRING_POLICY_TERMS_IMMUTABLE|RECURRING_POLICY_STATE_OR_ACTOR_INVALID/);
  assert.throws(()=>f.sql.prepare('DELETE FROM household_recurring_finance_events').run(),
   /RECURRING_EVENT_IMMUTABLE/);
 }finally{f.close()}
});
test('exact signed monthly occurrence can be reserved only once, original receipt survives replay',async()=>{
 const f=fixture();try{
  const p=(await f.create()).data.policy;
  assert.equal((await f.policy(owner,f.root+'/'+p.policy_id+'/review',
   {expected_user_id:'owner',expected_version:1,decision:'approve'})).status,200);
  const x=f.claim(p.policy_id);
  assert.equal((await f.reserve(x,'receipt')).status,404);
  assert.equal((await f.reserve(x,'reserve',{badSign:true})).status,403);
  assert.equal((await f.reserve(x,'reserve',{withOrigin:true})).status,403);
  const result=await f.reserve(x);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.data.reserved_only,true);
  assert.equal(result.data.execution_permitted,false);
  assert.equal(result.data.ledger_applied,false);
  assert.equal(count(f.sql,'household_recurring_finance_reservations'),1);
  assert.equal(count(f.sql,'household_recurring_finance_events'),3);
  const replay=await f.reserve(x);
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
  const receipt=await f.reserve(x,'receipt');
  assert.equal(receipt.status,200);assert.equal(receipt.data.replayed,true);
  assert.equal(count(f.sql,'household_recurring_finance_reservations'),1);
  assert.equal(count(f.sql,'household_recurring_finance_events'),3);
  assert.equal((await f.reserve(f.claim(p.policy_id,{occurrence_id:'a'.repeat(32),
   entry_intent_sha256:'f'.repeat(64)}))).status,409);
  assert.equal((await f.reserve({...x,amount_jpy:999})).status,409);
  assert.throws(()=>f.sql.prepare('DELETE FROM household_recurring_finance_reservations').run(),
   /RECURRING_RESERVATION_IMMUTABLE/);
  assert.throws(()=>f.sql.prepare("UPDATE household_recurring_finance_reservations SET state='reserved_only'").run(),
   /RECURRING_RESERVATION_IMMUTABLE/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='entries'").get().n,0);
 }finally{f.close()}
});
test('quota, date, version, active identity and owner revocation prevent new monthly reservation',async()=>{
 for(const reason of ['quota','account','wrong_date','foreign','member_disabled','owner_disabled','revoked','audit']){
  const f=fixture();try{
   const p=(await f.create()).data.policy;
   assert.equal((await f.policy(owner,f.root+'/'+p.policy_id+'/review',
    {expected_user_id:'owner',expected_version:1,decision:'approve'})).status,200);
   let x=f.claim(p.policy_id);
   if(reason==='quota')x={...x,amount_jpy:5000};
   if(reason==='account')x={...x,source_account_version:2};
   if(reason==='wrong_date')x={...x,due_date:month()+'-01'};
   if(reason==='foreign')x={...x,household_id:'second'};
   if(reason==='member_disabled')f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('member');
   if(reason==='owner_disabled')f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('owner');
   if(reason==='revoked')assert.equal((await f.policy(source,f.root+'/'+p.policy_id+'/revoke',
    {expected_user_id:'member',expected_version:2})).status,200);
   if(reason==='audit')f.sql.exec("CREATE TRIGGER reject_occurrence_audit BEFORE INSERT ON household_recurring_finance_events "+
    "WHEN NEW.action='occurrence_reserved' BEGIN SELECT RAISE(ABORT,'AUDIT_REJECTION'); END;");
   const result=await f.reserve(x);
   assert.notEqual(result.status,200,reason);
   assert.equal(count(f.sql,'household_recurring_finance_reservations'),0,reason);
   assert.equal(count(f.sql,'household_recurring_finance_events'),reason==='revoked'?3:2,reason);
  }finally{f.close()}
 }
});
test('owner cannot create member policy, replay must match immutable terms, revoked plans remain non-executing',async()=>{
 const f=fixture();try{
  assert.equal((await f.create(owner,{...body(),expected_user_id:'owner'})).status,403);
  assert.equal((await f.create(source,{...body(),expected_user_id:'owner'})).status,400);
  assert.equal((await f.create(source,{...body(),start_month:'2023-01'})).status,400);
  assert.equal((await f.create(source,{...body(),due_day:29})).status,400);
  const original=await f.create();assert.equal(original.status,201);
  const retry=await f.create();assert.equal(retry.status,200);
  assert.equal(retry.data.replayed,true);
  const changed=await f.create(source,{...body(),max_amount_jpy:6000});
  assert.equal(changed.status,409);
  const id=original.data.policy.policy_id;
  assert.equal((await f.policy(owner,f.root+'/'+id+'/review',
   {expected_user_id:'owner',expected_version:1,decision:'reject'})).status,200);
  assert.equal((await f.policy(owner,f.root+'/'+id+'/review',
   {expected_user_id:'owner',expected_version:2,decision:'approve'})).status,409);
  assert.equal(count(f.sql,'household_recurring_finance_policies'),1);
  assert.equal(count(f.sql,'household_recurring_finance_events'),2);
 }finally{f.close()}
});

test('new owner review is retired by default while historical records remain readable',async()=>{
 const f=fixture()
 try{
  f.env.RECURRING_LEGACY_OWNER_REVIEW_ENABLED='false'
  const res=await f.create()
  assert.equal(res.status,410)
  assert.equal(res.data.code,'recurring_plan_owner_review_retired')
  assert.equal(count(f.sql,'household_recurring_finance_policies'),0)
 }finally{f.close()}
})
