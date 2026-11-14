// End-to-end P0-4 points earn / linked discount / expiry.
// TWO physically isolated SQLite databases, real source/target handlers,
// real HomeFlow approval+lease+signed Service Binding. NEVER production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {pointsApprovalSubmissionRoute} from '../worker/points-approval-submission.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalRoute} from '../worker/approvals.js';
import {familyPointsActions} from '../.contract-kakeibo/functions/api/family-finance/points-actions.js';
import {approvedPointsRoute} from '../.contract-kakeibo/functions/api/internal/points-actions/points-execution.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',
 points='a'.repeat(32),card='b'.repeat(32),prepaid='c'.repeat(32);
const keys={pending:'1'.repeat(64),submit:'2'.repeat(64),
 execution:'3'.repeat(64),proof:'4'.repeat(64)};
const stmt=(s,q,...a)=>s.prepare(q).run(...a),get=(s,q,...a)=>s.prepare(q).get(...a);
function db(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 return {sql,db:{prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(actions){
  sql.exec('BEGIN IMMEDIATE');try{
   const out=actions.map(a=>a.sync());sql.exec('COMMIT');return out;
  }catch(e){sql.exec('ROLLBACK');throw e}
 }}};
}
function homeSchema(s){
 const src=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8');
 const names=src.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g).map(x=>x.slice(1,-1));
 for(const name of names)s.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 stmt(s,'INSERT INTO households(id,display_name) VALUES(?,?)',hh,'Home');
 for(const [u,role] of [[owner,'owner'],[member,'member']]){
  stmt(s,'INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)',u,u,'s','v');
  stmt(s,'INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)',hh,u,role);
 }
}
function financeSchema(s){
 for(const n of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0027_family_legacy_entry_link_audit.sql'])
  s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+n,import.meta.url),'utf8'));
 s.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0033_member_prepaid_actions.sql',import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../.contract-kakeibo/migrations/0034_family_points_foundation.sql',import.meta.url),'utf8');
 s.exec(migration);s.exec(migration);
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0035_points_prepaid_atomic.sql',import.meta.url),'utf8'));
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  stmt(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,hh,role,role,'active',Date.now());
 for(const [a,kind] of [[points,'points'],[card,'credit_card'],[prepaid,'prepaid']])
  stmt(s,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)',
   a,hh,member,kind,kind,'member_created',member,member);
 stmt(s,"INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(1,'2026-11-14','',900,'食費','Shop','','','expense',NULL,0,NULL,'purchase-1',?, ?,NULL)",
  'cc:'+card,card);
 stmt(s,"INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(2,'2026-11-14','',50,'雑費','Point shop','','','expense',NULL,0,NULL,'points-purchase',?, ?,NULL)",
  'points:'+points,points);
}
async function fixture(){
 const h=db(),k=db();homeSchema(h.sql);financeSchema(k.sql);
 const home={APP_ENV:'production',DB:h.db,
  APPROVALS_ENABLED:'true',APPROVAL_SUBMISSION_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  APPROVAL_VERIFICATION_SECRET:'5'.repeat(64),
  POINTS_APPROVAL_SUBMISSION_ENABLED:'true',POINTS_SUBMISSION_SECRET:keys.submit,
  POINTS_APPROVAL_EXECUTION_ENABLED:'true',POINTS_EXECUTION_SECRET:keys.execution,
  POINTS_APPROVAL_PROOF_SECRET:keys.proof};
 const finance={APP_ENV:'production',DB:k.db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_POINTS_ACTIONS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_POINTS_SUBMISSION_SECRET:keys.submit,
  KAKEIBO_POINTS_EXECUTION_SECRET:keys.execution,
  KAKEIBO_POINTS_PROOF_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 const calls={submit:0,proof:0,execute:0,receipt:0};
 finance.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname.endsWith('/points-submit')){
   calls.submit++;return pointsApprovalSubmissionRoute(req,home);
  }
  calls.proof++;return approvalVerificationRoute(req,home);
 }};
 home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  calls[mode]++;return approvedPointsRoute(req,finance,[mode]);
 }};
 const url=new URL('https://kakeibo.example.test/api/family-finance/points-actions');
 const actor={user_id:member,household_id:hh,role:'member'};
 const source=async(parts,body)=>{
  const r=await familyPointsActions(new Request(url,{method:'POST',
   headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)}),finance,url,actor,parts);
  return {status:r.status,data:await r.json()};
 };
 let seq=0;
 const intent=(operation,overrides={})=>({
  expected_user_id:member,idempotency_key:'points-real-'+(++seq)+'-20261114',
  points_account_id:points,points_version:1,operation,
  effective_date:'2026-11-14',units:100,
  yen_value:100,rate_numerator:1,rate_denominator:1,
  source_reference:'official-points-notice-'+seq,
  linked_entry_id:['earn_purchase','redeem_discount'].includes(operation)?1:
   operation==='redeem_purchase'?2:null,
  expense_net_confirmed:operation==='redeem_discount',
  ...(operation==='transfer_prepaid'?{target_account_id:prepaid,target_version:1}:{}),
  ...overrides
 });
 const request=async body=>{
  const prepared=await source(['points-actions'],body);
  assert.equal(prepared.status,201,JSON.stringify(prepared));
  const approval=await source(['points-actions',prepared.data.prepared.request_id,'submit'],
   {expected_user_id:member});
  assert.equal(approval.status,200,JSON.stringify(approval));
  assert.equal(get(k.sql,'SELECT COUNT(*) n FROM family_points_journal').n,
   get(k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n);
  return approval.data.approval_id;
 };
 const review=approval=>approvalRoute(new Request('https://homeflow.example.test/api/approvals/'+approval+'/review',{
  method:'POST',headers:{origin:'https://homeflow.example.test','content-type':'application/json'},
  body:JSON.stringify({decision:'approve'})}),home,'/api/approvals/'+approval+'/review',
  {user_id:owner,household_id:hh,role:'owner'});
 const execute=async approval=>{
  const path='/api/approvals/'+approval+'/execute';
  const r=await approvalExecutionRoute(new Request('https://homeflow.example.test'+path,{
   method:'POST',headers:{origin:'https://homeflow.example.test','content-type':'application/json'},
   body:'{}'}),home,path,{user_id:owner,household_id:hh,role:'owner'});
  return {status:r.status,data:await r.json()};
 };
 return {h,k,home,finance,calls,intent,source,request,review,execute,
  close(){h.sql.close();k.sql.close()}};
}
test('two SQLite: signed HomeFlow review awards points, discounts only linked expense, expires; no duplicate cash income/expense',async()=>{
 const f=await fixture();try{
  const initial=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const earned=await f.request(f.intent('earn_purchase'));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
  assert.equal((await f.review(earned)).status,200);
  const credit=await f.execute(earned);
  assert.equal(credit.status,200,JSON.stringify(credit));
  assert.equal(credit.data.applied,true);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,100);
  const discount=await f.request(f.intent('redeem_discount',{units:30,yen_value:30}));
  assert.equal((await f.review(discount)).status,200);
  assert.equal((await f.execute(discount)).status,200);
  const expired=await f.request(f.intent('expire',{units:20,yen_value:20}));
  assert.equal((await f.review(expired)).status,200);
  assert.equal((await f.execute(expired)).status,200);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,50);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,initial);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,3);
  assert.equal(get(f.h.sql,"SELECT COUNT(*) n FROM household_approval_requests WHERE status='applied'").n,3);
  const replay=await f.execute(expired);
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
 }finally{f.close()}
});
test('source already committed but receipt vanished; reconcile same ID, never mint again',async()=>{
 const f=await fixture();try{
  const approval=await f.request(f.intent('earn_campaign'));
  assert.equal((await f.review(approval)).status,200);
  const original=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const done=await original.fetch(req);
   if(done.status===200)throw Error('response lost after target COMMIT');
   return done;
  }};
  const first=await f.execute(approval);assert.notEqual(first.status,200);
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,
   'failed_retryable');
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_journal').n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=original;
  const recovered=await f.execute(approval);
  assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_journal').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,1);
  assert.equal(f.calls.proof,1);
 }finally{f.close()}
});
test('two SQLite: refuse unreviewed, revoked member, stale points account, disabled owner',async()=>{
 for(const mode of ['unreviewed','revoked','stale_version','owner_disabled']){
  const f=await fixture();try{
   const approval=await f.request(f.intent('earn_campaign'));
   if(mode!=='unreviewed')assert.equal((await f.review(approval)).status,200);
   if(mode==='revoked')stmt(f.k.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",member);
   if(mode==='stale_version')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',points);
   if(mode==='owner_disabled')stmt(f.h.sql,'UPDATE users SET disabled_at=? WHERE id=?',Date.now(),owner);
   const rejected=await f.execute(approval);
   assert.notEqual(rejected.status,200,JSON.stringify({mode,rejected}));
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,0);
  }finally{f.close()}
 }
});

test('true points-funded purchase must reference its existing one expense; no second cash entry',async()=>{
 const f=await fixture();try{
  const baseline=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const earning=await f.request(f.intent('earn_campaign',{units:100,yen_value:100}));
  assert.equal((await f.review(earning)).status,200);
  assert.equal((await f.execute(earning)).status,200);
  const spend=await f.request(f.intent('redeem_purchase',{units:50,yen_value:50}));
  assert.equal((await f.review(spend)).status,200);
  const done=await f.execute(spend);
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,baseline);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,50);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
 }finally{f.close()}
});

test('two isolated D1s: approved point-to-prepaid posting is double-sided, immutable, and receipt-recoverable',async()=>{
 const f=await fixture();try{
  const baseline=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const earned=await f.request(f.intent('earn_campaign',{units:400,yen_value:400}));
  assert.equal((await f.review(earned)).status,200);
  assert.equal((await f.execute(earned)).status,200);
  const transfer=await f.request(f.intent('transfer_prepaid',{units:150,yen_value:150}));
  assert.equal((await f.review(transfer)).status,200);
  const original=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const result=await original.fetch(req);
   if(result.status===200)throw Error('lost acknowledgement after atomic SQLite credit');
   return result;
  }};
  assert.notEqual((await f.execute(transfer)).status,200);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,250);
  assert.equal(get(f.k.sql,'SELECT SUM(amount_jpy) n FROM family_points_prepaid_credits').n,150);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,baseline);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=original;
  const recovered=await f.execute(transfer);
  assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',transfer).status,'applied');
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type IN ('income','expense','transfer')").n,
   get(f.k.sql,'SELECT COUNT(*) n FROM entries').n);
 }finally{f.close()}
});
test('two isolated D1s: revoked prepaid ownership and stale prepaid CAS cannot mint prepaid credit',async()=>{
 for(const mode of ['stale','cross_owner']){
  const f=await fixture();try{
   const earned=await f.request(f.intent('earn_campaign',{units:200,yen_value:200}));
   assert.equal((await f.review(earned)).status,200);
   assert.equal((await f.execute(earned)).status,200);
   const transfer=await f.request(f.intent('transfer_prepaid',{units:100,yen_value:100}));
   assert.equal((await f.review(transfer)).status,200);
   if(mode==='stale')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',prepaid);
   if(mode==='cross_owner')stmt(f.k.sql,'UPDATE family_financial_accounts SET owner_user_id=? WHERE account_id=?',owner,prepaid);
   assert.notEqual((await f.execute(transfer)).status,200);
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,0);
   assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation='transfer_prepaid'").n,0);
  }finally{f.close()}
 }
});
