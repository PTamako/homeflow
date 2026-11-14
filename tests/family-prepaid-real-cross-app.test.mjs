// Real prepaid HOMEFLOW approval + real Kakeibo implementation.
// Completely isolated in-memory SQLite and fake transport. NEVER production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {prepaidApprovalSubmissionRoute} from '../worker/prepaid-approval-submission.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalRoute} from '../worker/approvals.js';
import {familyPrepaidActions} from '../.contract-kakeibo/functions/api/family-finance/prepaid-actions.js';
import {approvedPrepaidActionRoute} from '../.contract-kakeibo/functions/api/internal/prepaid-actions/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',
 prepaid='a'.repeat(32),bank='b'.repeat(32);
const secrets={pending:'2'.repeat(64),submit:'3'.repeat(64),
 execution:'4'.repeat(64),proof:'5'.repeat(64)};
const stmt=(s,q,...a)=>s.prepare(q).run(...a),get=(s,q,...a)=>s.prepare(q).get(...a);
function data(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 const db={prepare(q){return{bind(...params){return{
   first:async()=>sql.prepare(q).get(...params)||null,
   all:async()=>({results:sql.prepare(q).all(...params)}),
   run:async()=>({meta:{changes:sql.prepare(q).run(...params).changes}}),
   sync:()=>({meta:{changes:sql.prepare(q).run(...params).changes}})
 }}}},async batch(actions){
  sql.exec('BEGIN IMMEDIATE');try{
   const out=actions.map(a=>a.sync());sql.exec('COMMIT');return out
  }catch(e){sql.exec('ROLLBACK');throw e}
 }};
 return {sql,db};
}
function homeSchema(s){
 const content=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8');
 const names=content.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g)
  .map(x=>x.slice(1,-1));
 for(const name of names)s.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 stmt(s,'INSERT INTO households(id,display_name) VALUES(?,?)',hh,'Home');
 for(const [id,role] of [[owner,'owner'],[member,'member']]){
  stmt(s,'INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)',id,id,'s','v');
  stmt(s,'INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)',hh,id,role);
 }
}
function financeSchema(s){
 for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8'));
 s.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 const migration=readFileSync(new URL('../.contract-kakeibo/migrations/0033_member_prepaid_actions.sql',import.meta.url),'utf8');
 s.exec(migration);s.exec(migration);
 for(const [user,role] of [[owner,'owner'],[member,'member']])
  stmt(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   user,hh,role,role,'active',Date.now());
 for(const [id,kind] of [[prepaid,'prepaid'],[bank,'bank']])
  stmt(s,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)',
   id,hh,member,kind,kind,'member_created',member,member);
}
async function fixture(){
 const h=data(),k=data();homeSchema(h.sql);financeSchema(k.sql);
 const home={APP_ENV:'production',DB:h.db,APPROVALS_ENABLED:'true',
  APPROVAL_SUBMISSION_ENABLED:'true',APPROVAL_EXECUTION_ENABLED:'true',
  APPROVAL_VERIFICATION_ENABLED:'true',
  APPROVAL_VERIFICATION_SECRET:'6'.repeat(64),
  PREPAID_APPROVAL_SUBMISSION_ENABLED:'true',PREPAID_SUBMISSION_SECRET:secrets.submit,
  PREPAID_APPROVAL_EXECUTION_ENABLED:'true',PREPAID_EXECUTION_SECRET:secrets.execution,
  PREPAID_APPROVAL_PROOF_SECRET:secrets.proof};
 const fin={APP_ENV:'production',DB:k.db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_PREPAID_ACTIONS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:secrets.pending,
  KAKEIBO_PREPAID_SUBMISSION_SECRET:secrets.submit,
  KAKEIBO_PREPAID_EXECUTION_SECRET:secrets.execution,
  KAKEIBO_PREPAID_PROOF_SECRET:secrets.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 const calls={submit:0,proof:0,execute:0,receipt:0};
 fin.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname.endsWith('/prepaid-submit')){
   calls.submit++;return prepaidApprovalSubmissionRoute(req,home);
  }
  calls.proof++;return approvalVerificationRoute(req,home);
 }};
 home.KAKEIBO_PREPAID_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  calls[mode]++;return approvedPrepaidActionRoute(req,fin,[mode]);
 }};
 const url=new URL('https://kakeibo.example.test/api/family-finance/prepaid-actions');
 const actor={user_id:member,household_id:hh,role:'member'};
 const source=async(parts,body)=>{
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)});
  const r=await familyPrepaidActions(req,fin,url,actor,parts);
  return {status:r.status,data:await r.json()};
 };
 let seq=0;
 const topup=()=>({
  expected_user_id:member,idempotency_key:'approved-topup-'+(++seq)+'-20261114',
  prepaid_account_id:prepaid,prepaid_version:1,action:'topup',
  bank_account_id:bank,bank_version:1,date:'2026-11-14',
  amount_jpy:1000,bank_reference:'confirmed-from-bank-statement-20261114',
  statement_confirmed:true
 });
 const spend=(sum=400)=>({
  expected_user_id:member,idempotency_key:'approved-spend-'+(++seq)+'-20261114',
  prepaid_account_id:prepaid,prepaid_version:1,action:'spend',
  date:'2026-11-14',amount_jpy:sum,merchant:'セブン-イレブン',category:'食費',note:''
 });
 const request=async data=>{
  const r=await source(['prepaid-actions'],data);
  assert.equal(r.status,201,JSON.stringify(r));
  assert.equal(get(k.sql,'SELECT COUNT(*) n FROM family_prepaid_actions_applied').n,
   get(k.sql,'SELECT COUNT(*) n FROM family_prepaid_action_audit').n);
  const confirm=await source(['prepaid-actions',r.data.prepared.request_id,'submit'],
   {expected_user_id:member});
  assert.equal(confirm.status,200,JSON.stringify(confirm));
  return confirm.data.approval_id;
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
 return {h,k,home,fin,calls,topup,spend,request,review,execute,
  close(){h.sql.close();k.sql.close()}};
}
test('real HomeFlow approval creates one bank→prepaid transfer then one prepaid expense, never two expenses',async()=>{
 const f=await fixture();try{
  const topup=await f.request(f.topup());
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,0);
  assert.equal((await f.review(topup)).status,200);
  const funded=await f.execute(topup);
  assert.equal(funded.status,200,JSON.stringify(funded));
  assert.equal(funded.data.applied,true);
  assert.equal(get(f.k.sql,"SELECT SUM(amount) v FROM entries WHERE type='transfer'").v,1000);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,0);
  const spend=await f.request(f.spend(400));
  assert.equal((await f.review(spend)).status,200);
  const purchase=await f.execute(spend);
  assert.equal(purchase.status,200,JSON.stringify(purchase));
  assert.equal(get(f.k.sql,"SELECT SUM(amount) v FROM entries WHERE type='expense'").v,400);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_jpy) v FROM family_prepaid_balance_journal').v,600);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_prepaid_action_audit').n,2);
  const repeated=await f.execute(spend);
  assert.equal(repeated.status,200);assert.equal(repeated.data.replayed,true);
  assert.equal(f.calls.execute,2);assert.equal(f.calls.proof,2);
 }finally{f.close()}
});
test('real prepaid target commits, response vanishes; HomeFlow reconciles by original approval ID with no second debit',async()=>{
 const f=await fixture();try{
  const approved=await f.request(f.topup());
  assert.equal((await f.review(approved)).status,200);
  const original=f.home.KAKEIBO_PREPAID_EXECUTION_SERVICE;
  f.home.KAKEIBO_PREPAID_EXECUTION_SERVICE={async fetch(req){
   const done=await original.fetch(req);
   if(done.status===200)throw Error('network loss AFTER target database committed');
   return done;
  }};
  const lost=await f.execute(approved);assert.notEqual(lost.status,200);
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approved).status,
   'failed_retryable');
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_prepaid_balance_journal').n,1);
  f.home.KAKEIBO_PREPAID_EXECUTION_SERVICE=original;
  const recovered=await f.execute(approved);
  assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(recovered.data.applied,true);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_prepaid_action_audit').n,1);
  assert.equal(f.calls.proof,1);
 }finally{f.close()}
});
test('prepaid execution cannot bypass owner review, revoked actor or stale bank version',async()=>{
 for(const mode of ['not_reviewed','revoked','bank_version','prepaid_version','owner_disabled']){
  const f=await fixture();try{
   const approved=await f.request(f.topup());
   if(mode!=='not_reviewed')assert.equal((await f.review(approved)).status,200);
   if(mode==='revoked')stmt(f.k.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",member);
   if(mode==='bank_version')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',bank);
   if(mode==='prepaid_version')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',prepaid);
   if(mode==='owner_disabled')stmt(f.h.sql,'UPDATE users SET disabled_at=? WHERE id=?',Date.now(),owner);
   const denied=await f.execute(approved);
   assert.notEqual(denied.status,200,JSON.stringify({mode,denied}));
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_prepaid_balance_journal').n,0);
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_prepaid_actions_applied').n,0);
  }finally{f.close()}
 }
});
