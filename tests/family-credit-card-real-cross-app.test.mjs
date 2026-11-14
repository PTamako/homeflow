// Genuine HomeFlow + Kakeibo handlers against two independent SQLite D1s.
// No mock business decisions: mocks forward requests through real routes.
// Draft-only; Cloudflare bindings and production billing remain unverified.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {cardApprovalSubmissionRoute} from '../worker/card-approval-submission.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalRoute} from '../worker/approvals.js';
import {familyCardPurchases} from '../.contract-kakeibo/functions/api/family-finance/card-purchases.js';
import {approvedCardPurchaseRoute} from '../.contract-kakeibo/functions/api/internal/card-purchases/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const account='a'.repeat(32),hh='primary';
const host='https://homeflow.example.test';
const keys={cash:'1'.repeat(64),pending:'2'.repeat(64),
 submit:'3'.repeat(64),execute:'4'.repeat(64),proof:'5'.repeat(64)};
function data(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 const db={prepare(q){return{bind(...params){return{
  first:async()=>sql.prepare(q).get(...params)||null,
  all:async()=>({results:sql.prepare(q).all(...params)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...params).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...params).changes}})
 }}}},async batch(list){
  sql.exec('BEGIN IMMEDIATE');
  try{const r=list.map(x=>x.sync());sql.exec('COMMIT');return r}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 return {sql,db};
}
function homeSchema(sql){
 const c=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8');
 const names=c.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g)
  .map(x=>x.slice(1,-1));
 for(const n of names)sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 sql.prepare('INSERT INTO households(id,display_name) VALUES(?,?)').run(hh,'Home');
 for(const [id,role] of [[owner,'owner'],[member,'member']]){
  sql.prepare('INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)')
   .run(id,id,'s','v');
  sql.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
   .run(hh,id,role);
 }
}
function kakeiboSchema(sql){
 for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT);');
 const migration=readFileSync(new URL(
  '../.contract-kakeibo/migrations/0031_family_card_purchase_execution.sql',import.meta.url),'utf8');
 sql.exec(migration);sql.exec(migration);
 for(const [id,role] of [[owner,'owner'],[member,'member']]){
  sql.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
   .run(id,hh,role,role,'active',Date.now());
 }
 sql.prepare('INSERT INTO family_financial_accounts('+
  'account_id,household_id,owner_user_id,label,account_kind,origin,closing_day,'+
  'created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(account,hh,member,'Personal credit','credit_card','member_created',10,member,member);
}
async function fixture(){
 const h=data(),k=data();homeSchema(h.sql);kakeiboSchema(k.sql);
 const home={APP_ENV:'production',DB:h.db,
  APPROVALS_ENABLED:'true',APPROVAL_SUBMISSION_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  APPROVAL_VERIFICATION_SECRET:keys.cash,
  CARD_APPROVAL_SUBMISSION_ENABLED:'true',CARD_SUBMISSION_SECRET:keys.submit,
  CARD_APPROVAL_EXECUTION_ENABLED:'true',CARD_EXECUTION_SECRET:keys.execute,
  CARD_APPROVAL_PROOF_SECRET:keys.proof};
 const financial={APP_ENV:'production',DB:k.db,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_CARD_PURCHASES_ENABLED:'true',
  KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_CARD_SUBMISSION_SECRET:keys.submit,
  KAKEIBO_CARD_EXECUTION_SECRET:keys.execute,
  KAKEIBO_CARD_PROOF_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:host};
 const calls={submit:0,proof:0,execute:0,receipt:0};
 financial.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname==='/api/internal/approvals/card-submit'){
   calls.submit++;return cardApprovalSubmissionRoute(req,home);
  }
  calls.proof++;return approvalVerificationRoute(req,home);
 }};
 home.KAKEIBO_CARD_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  calls[mode]++;
  return approvedCardPurchaseRoute(req,financial,[mode]);
 }};
 const url=new URL('https://kakeibo.example.test/api/family-finance/card-purchases');
 const user={user_id:member,household_id:hh,role:'member'};
 const prepare=async()=>{
  const input={expected_user_id:member,idempotency_key:'homeflow-real-card-20261114',
   account_id:account,account_version:1,
   date:'2026-11-14',amount_jpy:1520,merchant:'マクドナルド',
   category:'食費',note:'家庭银行卡消费'};
  const r=await familyCardPurchases(new Request(url,{method:'POST',
   headers:{'content-type':'application/json',origin:url.origin},
   body:JSON.stringify(input)}),financial,url,user,['card-purchases']);
  return {status:r.status,data:await r.json()};
 };
 const submit=async id=>{
  const r=await familyCardPurchases(new Request(url,{method:'POST',
   headers:{'content-type':'application/json',origin:url.origin},
   body:JSON.stringify({expected_user_id:member})}),financial,url,user,
   ['card-purchases',id,'submit']);
  return {status:r.status,data:await r.json()};
 };
 const review=async id=>approvalRoute(new Request(host+'/api/approvals/'+id+'/review',{
  method:'POST',headers:{origin:host,'content-type':'application/json'},
  body:JSON.stringify({decision:'approve'})}),home,'/api/approvals/'+id+'/review',
  {household_id:hh,user_id:owner,role:'owner'});
 const execute=async id=>{
  const path='/api/approvals/'+id+'/execute';
  const r=await approvalExecutionRoute(new Request(host+path,{
   method:'POST',headers:{origin:host,'content-type':'application/json'},body:'{}'}),
   home,path,{household_id:hh,user_id:owner,role:'owner'});
  return {status:r.status,data:await r.json()};
 };
 const flow=async()=>{
  const prepared=await prepare();
  assert.equal(prepared.status,201,JSON.stringify(prepared));
  const submitted=await submit(prepared.data.prepared.request_id);
  assert.equal(submitted.status,200,JSON.stringify(submitted));
  assert.equal(submitted.data.applied,false);
  return {prepared:prepared.data.prepared,id:submitted.data.approval_id};
 };
 return {h,k,home,financial,calls,flow,execute,review,
  close(){h.sql.close();k.sql.close()}};
}
test('real HomeFlow card approval + Kakeibo encrypted source and target transaction never double-debits cash',async()=>{
 const f=await fixture();try{
  const {id}=await f.flow();
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
  const review=await f.review(id);
  assert.equal(review.status,200,await review.clone().text());
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0,
   'approval is not execution');
  const posted=await f.execute(id);
  assert.equal(posted.status,200,JSON.stringify(posted.data));
  assert.equal(posted.data.applied,true);
  const ledger=f.k.sql.prepare('SELECT * FROM entries').get();
  assert.equal(ledger.type,'expense');
  assert.equal(ledger.payment_source,'cc:'+account);
  assert.equal(ledger.amount,1520);
  assert.equal(ledger.transfer_target,null);
  const charge=f.k.sql.prepare('SELECT * FROM family_card_purchase_applied').get();
  assert.equal(charge.bill_month,'2026-12');
  assert.equal(charge.approver_user_id,owner);
  assert.equal(charge.account_version,1);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_audit').get().n,1);
  const applied=f.h.sql.prepare('SELECT * FROM household_approval_requests').get();
  assert.equal(applied.status,'applied');
  assert.equal(applied.remote_id,String(ledger.id));
  assert.equal(JSON.stringify(applied).includes('マクドナルド'),false,
   'HomeFlow never stores merchant text or private account labels');
  const repeated=await f.execute(id);
  assert.equal(repeated.status,200);
  assert.equal(repeated.data.replayed,true);
  assert.equal(f.calls.execute,1);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
 }finally{f.close()}
});
test('target commits but HomeFlow loses response: retry same ID replays original immutable credit receipt',async()=>{
 const f=await fixture();try{
  const {id}=await f.flow();
  assert.equal((await f.review(id)).status,200);
  const service=f.home.KAKEIBO_CARD_EXECUTION_SERVICE;
  f.home.KAKEIBO_CARD_EXECUTION_SERVICE={async fetch(req){
   const resp=await service.fetch(req);
   if(resp.status===200)throw Error('injected response loss after target D1 commit');
   return resp;
  }};
  const lost=await f.execute(id);
  assert.notEqual(lost.status,200);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'failed_retryable');
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,1);
  f.home.KAKEIBO_CARD_EXECUTION_SERVICE=service;
  const recovered=await f.execute(id);
  assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(recovered.data.applied,true);
  assert.equal(f.calls.proof,1);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,1);
 }finally{f.close()}
});
test('revoked card owner or changed CAS version blocks remote execution after approved review',async()=>{
 for(const mode of ['revoked','version','member']){
  const f=await fixture();try{
   const {id}=await f.flow();
   assert.equal((await f.review(id)).status,200);
   if(mode==='revoked')f.k.sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(member);
   if(mode==='version')f.k.sql.prepare('UPDATE family_financial_accounts SET version=2 WHERE account_id=?').run(account);
   if(mode==='member')f.h.sql.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(Date.now(),member);
   const failed=await f.execute(id);
   assert.notEqual(failed.status,200,JSON.stringify({mode,failed}));
   assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
   assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,0);
  }finally{f.close()}
 }
});
