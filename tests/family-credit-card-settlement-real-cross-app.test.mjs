// Real HomeFlow approval state machine + real Kakeibo card SETTLEMENT target.
// Two isolated SQLite databases and a simulated Service Binding transport.
// This is NOT a Cloudflare D1/production/PWA acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {cardSettlementApprovalSubmissionRoute} from '../worker/card-settlement-approval-submission.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalRoute} from '../worker/approvals.js';
import {familyCardSettlements} from '../.contract-kakeibo/functions/api/family-finance/card-settlements.js';
import {approvedCardSettlementRoute} from '../.contract-kakeibo/functions/api/internal/card-settlements/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const card='a'.repeat(32),bank='b'.repeat(32);
const pa='11111111-1111-4111-8111-111111111112',pb='11111111-1111-4111-8111-111111111113';
const host='https://homeflow.example.test';
const keys={approval:'1'.repeat(64),pending:'2'.repeat(64),
 submission:'3'.repeat(64),execution:'4'.repeat(64),proof:'5'.repeat(64)};
const stmt=(s,q,...args)=>s.prepare(q).run(...args);
const get=(s,q,...args)=>s.prepare(q).get(...args);
function data(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 const db={prepare(q){return{bind(...params){return{
   first:async()=>sql.prepare(q).get(...params)||null,
   all:async()=>({results:sql.prepare(q).all(...params)}),
   run:async()=>({meta:{changes:sql.prepare(q).run(...params).changes}}),
   sync:()=>({meta:{changes:sql.prepare(q).run(...params).changes}})
 };}}},async batch(list){
  sql.exec('BEGIN IMMEDIATE');
  try{const result=list.map(x=>x.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
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
function financialSchema(s){
 for(const f of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
   '0027_family_legacy_entry_link_audit.sql'])
  s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+f,import.meta.url),'utf8'));
 s.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT,'+
  'family_transfer_target_account_id TEXT);');
 for(const name of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql']){
  const x=readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8');
  s.exec(x);s.exec(x);
 }
 for(const name of ['0033_member_prepaid_actions.sql','0034_family_points_foundation.sql',
  '0035_points_prepaid_atomic.sql','0036_points_card_offset.sql',
   '0037_points_transfer_exchange.sql','0038_points_earn_expiry_reversals.sql',
   '0039_points_legacy_provenance.sql','0040_points_sbi_lots.sql',
   '0041_points_transfer_atomic_refund.sql','0042_points_prepaid_refund.sql',
   '0043_points_card_offset_refund.sql'])
  s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8'));
 for(const [user,role] of [[owner,'owner'],[member,'member']])
  stmt(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   user,hh,role,role,'active',Date.now());
 for(const [id,kind,closing] of [[card,'credit_card',10],[bank,'bank',null]])
  stmt(s,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,closing_day,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)',
   id,hh,member,kind,kind,'member_created',closing,member,member);
 for(const [request,proposal,amount,date,month] of [
  [pa,'c'.repeat(32),1000,'2026-11-14','2026-12'],
  [pb,'d'.repeat(32),500,'2026-10-14','2026-11']]){
  stmt(s,"INSERT INTO family_card_purchase_intents(request_id,household_id,requester_user_id,account_id,account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
   proposal,hh,member,card,1,'f'.repeat(64),'cipher','iv',
   proposal.padEnd(64,'1'),request,Date.now()-1000,Date.now()+86400000,Date.now());
  stmt(s,"INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,family_account_id) VALUES(?,'',?,'食費','Store','','','expense',?,?,?)",
   date,amount,'hfcard:'+request,'cc:'+card,card);
  const entry=get(s,'SELECT id FROM entries WHERE client_request_id=?','hfcard:'+request).id;
  stmt(s,'INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   request,proposal,hh,member,owner,card,1,'f'.repeat(64),
   'hfcard:'+request,entry,amount,date,month,Date.now());
 }
}
async function fixture(){
 const homeDb=data(),financeDb=data();homeSchema(homeDb.sql);financialSchema(financeDb.sql);
 const home={APP_ENV:'production',DB:homeDb.db,APPROVALS_ENABLED:'true',
  APPROVAL_SUBMISSION_ENABLED:'true',APPROVAL_EXECUTION_ENABLED:'true',
  APPROVAL_VERIFICATION_ENABLED:'true',APPROVAL_VERIFICATION_SECRET:keys.approval,
  CARD_SETTLEMENT_APPROVAL_SUBMISSION_ENABLED:'true',
  CARD_SETTLEMENT_SUBMISSION_SECRET:keys.submission,
  CARD_SETTLEMENT_APPROVAL_EXECUTION_ENABLED:'true',
  CARD_SETTLEMENT_EXECUTION_SECRET:keys.execution,
  CARD_SETTLEMENT_APPROVAL_PROOF_SECRET:keys.proof};
 const finance={APP_ENV:'production',DB:financeDb.db,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_CARD_SETTLEMENTS_ENABLED:'true',
  KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_CARD_SETTLEMENT_EXECUTION_SECRET:keys.execution,
  KAKEIBO_CARD_SETTLEMENT_PROOF_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:host};
 const calls={submission:0,proof:0,execute:0,receipt:0};
 finance.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname==='/api/internal/approvals/card-settlement-submit'){
   calls.submission++;return cardSettlementApprovalSubmissionRoute(req,home);
  }
  calls.proof++;return approvalVerificationRoute(req,home);
 }};
 home.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  calls[mode]++;return approvedCardSettlementRoute(req,finance,[mode]);
 }};
 const url=new URL('https://kakeibo.example.test/api/family-finance/card-settlements');
 const user={user_id:member,household_id:hh,role:'member'};
 const source=async(parts,body)=>{
  const request=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)});
  const response=await familyCardSettlements(request,finance,url,user,parts);
  return {status:response.status,data:await response.json()};
 };
 const request=async()=>{
  const input={expected_user_id:member,idempotency_key:'real-cross-card-settlement-20261114',
   card_account_id:card,card_version:1,bank_account_id:bank,bank_version:1,
   debit_date:'2026-11-14',amount_jpy:1200,bank_reference:'verified-bank-ref-20261114',
   statement_confirmed:true,
   allocations:[{purchase_request_id:pa,amount_jpy:800},{purchase_request_id:pb,amount_jpy:400}]};
  const p=await source(['card-settlements'],input);
  assert.equal(p.status,201,JSON.stringify(p));
  assert.equal(get(financeDb.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0);
  const s=await source(['card-settlements',p.data.prepared.request_id,'submit'],
   {expected_user_id:member});
  assert.equal(s.status,200,JSON.stringify(s));
  return {approval:s.data.approval_id,proposal:p.data.prepared.request_id};
 };
 const review=async approval=>approvalRoute(new Request(host+'/api/approvals/'+approval+'/review',{
   method:'POST',headers:{origin:host,'content-type':'application/json'},
   body:JSON.stringify({decision:'approve'})}),home,'/api/approvals/'+approval+'/review',
   {user_id:owner,household_id:hh,role:'owner'});
 const execute=async approval=>{
  const path='/api/approvals/'+approval+'/execute';
  const r=await approvalExecutionRoute(new Request(host+path,{
   method:'POST',headers:{origin:host,'content-type':'application/json'},body:'{}'}),
   home,path,{user_id:owner,household_id:hh,role:'owner'});
  return {status:r.status,data:await r.json()};
 };
 return {h:homeDb,k:financeDb,home,finance,calls,request,review,execute,
  close(){homeDb.sql.close();financeDb.sql.close()}};
}
test('approved HomeFlow settlement executes real Kakeibo transfer: bank debit reduces card obligation, no duplicate household expense',async()=>{
 const f=await fixture();try{
  const {approval}=await f.request();
  const before=get(f.k.sql,"SELECT SUM(amount) total FROM entries WHERE type='expense'");
  assert.equal(before.total,1500);
  const reviewed=await f.review(approval);assert.equal(reviewed.status,200,await reviewed.clone().text());
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0);
  const executed=await f.execute(approval);
  assert.equal(executed.status,200,JSON.stringify(executed));
  assert.equal(executed.data.applied,true);
  assert.equal(get(f.k.sql,"SELECT SUM(amount) total FROM entries WHERE type='expense'").total,1500);
  assert.equal(get(f.k.sql,"SELECT SUM(amount) total FROM entries WHERE type='transfer'").total,1200);
  assert.equal(get(f.k.sql,'SELECT SUM(amount_jpy) total FROM family_card_settlement_allocations').total,1200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_card_settlement_audit').n,1);
  const h=get(f.h.sql,'SELECT * FROM household_approval_requests WHERE request_id=?',approval);
  assert.equal(h.status,'applied');
  assert.equal(h.remote_id,String(get(f.k.sql,"SELECT id FROM entries WHERE type='transfer'").id));
  assert.equal(JSON.stringify(h).includes('verified-bank-ref'),false);
  const repeated=await f.execute(approval);
  assert.equal(repeated.status,200);assert.equal(repeated.data.replayed,true);
  assert.equal(f.calls.execute,1);assert.equal(f.calls.proof,1);
 }finally{f.close()}
});
test('target commits and response lost, same HomeFlow ID reconciles immutable transfer without another debit',async()=>{
 const f=await fixture();try{
  const {approval}=await f.request();
  assert.equal((await f.review(approval)).status,200);
  const service=f.home.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE;
  f.home.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE={async fetch(req){
   const result=await service.fetch(req);
   if(result.status===200)throw Error('simulate remote bank-settlement receipt lost');
   return result;
  }};
  const lost=await f.execute(approval);assert.notEqual(lost.status,200);
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,'failed_retryable');
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_card_settlements_applied').n,1);
  f.home.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE=service;
  const recovered=await f.execute(approval);
  assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(recovered.data.applied,true);
  assert.equal(f.calls.proof,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_card_bank_debit_evidence').n,1);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,1);
 }finally{f.close()}
});
test('owner review cannot override revoked member or mutated bank/card CAS',async()=>{
 for(const mode of ['member_revoked','card_version','bank_version','owner_disabled']){
  const f=await fixture();try{
   const {approval}=await f.request();
   assert.equal((await f.review(approval)).status,200);
   if(mode==='member_revoked')stmt(f.k.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",member);
   if(mode==='card_version')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',card);
   if(mode==='bank_version')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',bank);
   if(mode==='owner_disabled')stmt(f.h.sql,'UPDATE users SET disabled_at=? WHERE id=?',Date.now(),owner);
   const failed=await f.execute(approval);
   assert.notEqual(failed.status,200,JSON.stringify({mode,failed}));
   assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0);
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_card_settlements_applied').n,0);
  }finally{f.close()}
 }
});
