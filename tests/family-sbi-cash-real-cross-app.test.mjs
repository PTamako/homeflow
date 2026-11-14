// DRAFT P0-4B: real HomeFlow review and Kakeibo SBI cash executor, independent SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {sbiCashApprovalSubmissionRoute} from '../worker/sbi-cash-approval-submission.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalRoute} from '../worker/approvals.js';
import {familySbiCashActions} from '../.contract-kakeibo/functions/api/family-finance/sbi-cash-actions.js';
import {approvedSbiCashRoute} from '../.contract-kakeibo/functions/api/internal/sbi-cash-actions/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const bank='b'.repeat(32),securities='c'.repeat(32),host='https://homeflow.example.test';
const keys={approval:'1'.repeat(64),pending:'2'.repeat(64),submission:'3'.repeat(64),
 execution:'4'.repeat(64),proof:'5'.repeat(64)};
const stmt=(s,q,...p)=>s.prepare(q).run(...p);
const get=(s,q,...p)=>s.prepare(q).get(...p);
function data(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 const db={prepare(q){return {bind(...p){return {
  first:async()=>sql.prepare(q).get(...p)||null,
  all:async()=>({results:sql.prepare(q).all(...p)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...p).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...p).changes}})
 };}}},async batch(commands){
  sql.exec('BEGIN IMMEDIATE');
  try{const r=commands.map(x=>x.sync());sql.exec('COMMIT');return r;}
  catch(e){sql.exec('ROLLBACK');throw e;}
 }};
 return {sql,db};
}
function homeSchema(sql){
 const body=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8');
 const names=body.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g).map(s=>s.slice(1,-1));
 for(const x of names)sql.exec(readFileSync(new URL('../migrations/'+x,import.meta.url),'utf8'));
 stmt(sql,'INSERT INTO households(id,display_name) VALUES(?,?)',hh,'Family');
 for(const [u,role] of [[owner,'owner'],[member,'member']]){
  stmt(sql,'INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)',u,u,'s','v');
  stmt(sql,'INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)',hh,u,role);
 }
}
function financeSchema(sql){
 for(const x of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0027_family_legacy_entry_link_audit.sql'])
  sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+x,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 for(const x of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql','0034_family_points_foundation.sql',
  '0035_points_prepaid_atomic.sql','0036_points_card_offset.sql','0037_points_transfer_exchange.sql',
  '0038_points_earn_expiry_reversals.sql','0039_points_legacy_provenance.sql',
  '0040_points_sbi_lots.sql','0041_points_transfer_atomic_refund.sql',
  '0042_points_prepaid_refund.sql','0043_points_card_offset_refund.sql',
  '0044_sbi_cash_purchases.sql'])
  sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+x,import.meta.url),'utf8'));
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,hh,role,role,'active',Date.now());
 for(const [a,kind,opening] of [[bank,'bank',3000],[securities,'securities',0]])
  stmt(sql,'INSERT INTO family_financial_accounts '+
   '(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,created_by_user_id,updated_by_user_id) '+
   'VALUES(?,?,?,?,?,?,?,?,?)',a,hh,member,kind,kind,'member_created',opening,member,member);
}
async function fixture(){
 const h=data(),k=data();homeSchema(h.sql);financeSchema(k.sql);
 const home={APP_ENV:'production',DB:h.db,APPROVALS_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  APPROVAL_VERIFICATION_SECRET:keys.approval,
  SBI_CASH_APPROVAL_SUBMISSION_ENABLED:'true',SBI_CASH_SUBMISSION_SECRET:keys.submission,
  SBI_CASH_APPROVAL_EXECUTION_ENABLED:'true',SBI_CASH_EXECUTION_SECRET:keys.execution,
  SBI_CASH_APPROVAL_PROOF_SECRET:keys.proof};
 const finance={APP_ENV:'production',DB:k.db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_SBI_CASH_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_SBI_CASH_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_SBI_CASH_EXECUTION_SECRET:keys.execution,
  KAKEIBO_SBI_CASH_PROOF_SECRET:keys.proof,HOMEFLOW_OAUTH_ORIGIN:host};
 const calls={submission:0,proof:0,execute:0,receipt:0};
 finance.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname.endsWith('/sbi-cash-submit')){
   calls.submission++;return sbiCashApprovalSubmissionRoute(req,home);
  }
  calls.proof++;return approvalVerificationRoute(req,home);
 }};
 home.KAKEIBO_SBI_CASH_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  calls[mode]++;return approvedSbiCashRoute(req,finance,[mode]);
 }};
 const url=new URL('https://kakeibo.example.test/api/family-finance/sbi-cash-actions');
 const source=async(parts,body)=>{
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)});
  const res=await familySbiCashActions(req,finance,url,{user_id:member,household_id:hh,role:'member'},parts);
  return {status:res.status,data:await res.json()};
 };
 const request=async()=>{
  const input={expected_user_id:member,idempotency_key:'real-cross-sbi-cash-20261115',
   bank_account_id:bank,bank_version:1,securities_account_id:securities,
   securities_version:1,kind:'tsumitate',debit_date:'2026-11-12',trade_date:'2026-11-13',
   effective_date:'2026-11-14',amount_jpy:1500,
   bank_reference:'confirmed-bank-statement-ref-20261112',
   broker_trade_reference:'confirmed-broker-execution-20261113',
   fund_code:'1234ABCD',account_type:'tsumitate',confirmed_units:1234500,
   bank_debit_confirmed:true,broker_execution_attested:true};
  const prepared=await source(['sbi-cash-actions'],input);
  assert.equal(prepared.status,201,JSON.stringify(prepared));
  assert.equal(get(k.sql,'SELECT COUNT(*) n FROM entries').n,0);
  const submitted=await source(['sbi-cash-actions',prepared.data.prepared.request_id,'submit'],
   {expected_user_id:member});
  assert.equal(submitted.status,200,JSON.stringify(submitted));
  return submitted.data.approval_id;
 };
 const review=async id=>approvalRoute(new Request(host+'/api/approvals/'+id+'/review',{
  method:'POST',headers:{origin:host,'content-type':'application/json'},
  body:JSON.stringify({decision:'approve'})}),home,'/api/approvals/'+id+'/review',
  {user_id:owner,household_id:hh,role:'owner'});
 const execute=async id=>{
  const path='/api/approvals/'+id+'/execute';
  const res=await approvalExecutionRoute(new Request(host+path,{
   method:'POST',headers:{origin:host,'content-type':'application/json'},body:'{}'}),
   home,path,{user_id:owner,household_id:hh,role:'owner'});
  return {status:res.status,data:await res.json()};
 };
 return {h,k,home,finance,calls,request,review,execute,
  close(){h.sql.close();k.sql.close();}};
}
test('owner approves actual SBI cash trade: independent HomeFlow/Kakeibo D1, one immutable bank debit + lot',async()=>{
 const f=await fixture();try{
  const id=await f.request();
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,0);
  const review=await f.review(id);assert.equal(review.status,200,await review.clone().text());
  const done=await f.execute(id);assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(done.data.applied,true);
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',id).status,'applied');
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_cash_lots').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_cash_audit').n,1);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,0);
  assert.equal(f.calls.proof,1);assert.equal(f.calls.execute,1);
  const duplicate=await f.execute(id);assert.equal(duplicate.status,200);assert.equal(f.calls.execute,1);
 }finally{f.close();}
});
test('lost target acknowledgement does not mint a second lot or debit; same approval recovers immutable receipt',async()=>{
 const f=await fixture();try{
  const id=await f.request();assert.equal((await f.review(id)).status,200);
  const service=f.home.KAKEIBO_SBI_CASH_EXECUTION_SERVICE;
  let throwOnce=true;
  f.home.KAKEIBO_SBI_CASH_EXECUTION_SERVICE={async fetch(req){
   const res=await service.fetch(req);
   if(throwOnce){throwOnce=false;throw Error('LOST_RECEIPT');}
   return res;
  }};
  const unknown=await f.execute(id);assert.notEqual(unknown.status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_cash_lots').n,1);
  const recovered=await f.execute(id);assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_cash_lots').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,1);
 }finally{f.close();}
});
