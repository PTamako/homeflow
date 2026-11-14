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
 points='a'.repeat(32),card='b'.repeat(32),prepaid='c'.repeat(32),receive='e'.repeat(32),securities='6'.repeat(32),cardPurchase='11111111-1111-4111-8111-111111111114';
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
 for(const name of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql'])
  s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../.contract-kakeibo/migrations/0034_family_points_foundation.sql',import.meta.url),'utf8');
 s.exec(migration);s.exec(migration);
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0035_points_prepaid_atomic.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0036_points_card_offset.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0037_points_transfer_exchange.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0038_points_earn_expiry_reversals.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0040_points_sbi_lots.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0041_points_transfer_atomic_refund.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0042_points_prepaid_refund.sql',import.meta.url),'utf8'));
 s.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0043_points_card_offset_refund.sql',import.meta.url),'utf8'));
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  stmt(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,hh,role,role,'active',Date.now());
 for(const [a,kind] of [[points,'points'],[card,'credit_card'],[prepaid,'prepaid'],[receive,'points'],[securities,'securities']])
  stmt(s,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)',
   a,hh,member,kind,kind,'member_created',member,member);
 stmt(s,"INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(1,'2026-11-14','',900,'食費','Shop','','','expense',NULL,0,NULL,'purchase-1',?, ?,NULL)",
  'cc:'+card,card);
 stmt(s,"INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(2,'2026-11-14','',50,'雑費','Point shop','','','expense',NULL,0,NULL,'points-purchase',?, ?,NULL)",
  'points:'+points,points);
 const cardIntent='f'.repeat(32),now=Date.now();
 stmt(s,"INSERT INTO family_card_purchase_intents(request_id,household_id,requester_user_id,account_id,account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
  cardIntent,hh,member,card,1,'f'.repeat(64),'encrypted','iv','e'.repeat(64),
  cardPurchase,now-1000,now+86400000,now);
 stmt(s,'INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  cardPurchase,cardIntent,hh,member,owner,card,1,'f'.repeat(64),
  'purchase-1',1,900,'2026-11-14','2026-11',now);
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
  ...(operation==='offset_card'?{target_account_id:card,target_version:1,
   target_purchase_request_id:cardPurchase}:{}),
  ...(['transfer_out','exchange_out'].includes(operation)?{target_account_id:receive,
   target_version:1,target_units:100,target_rate_numerator:1,target_rate_denominator:1}:{}),
  ...(operation==='reversal'?{original_request_id:'11111111-1111-4111-8111-111111111111'}:{}),
  ...(operation==='redeem_asset'?{target_account_id:securities,target_version:1,
   sbi_fund_code:'JP123456',sbi_account_type:'growth',sbi_confirmed_units:1000,
   broker_trade_reference:'SBI-TRD-'+seq+'-CONFIRMED',
   broker_execution_confirmed:true}:{}),
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
 for(const mode of ['stale','archived']){
  const f=await fixture();try{
   const earned=await f.request(f.intent('earn_campaign',{units:200,yen_value:200}));
   assert.equal((await f.review(earned)).status,200);
   assert.equal((await f.execute(earned)).status,200);
   const transfer=await f.request(f.intent('transfer_prepaid',{units:100,yen_value:100}));
   assert.equal((await f.review(transfer)).status,200);
   if(mode==='stale')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',prepaid);
   if(mode==='archived')stmt(f.k.sql,'UPDATE family_financial_accounts SET is_archived=1 WHERE account_id=?',prepaid);
   assert.notEqual((await f.execute(transfer)).status,200);
   assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,0);
   assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation='transfer_prepaid'").n,0);
  }finally{f.close()}
 }
});

test('two isolated D1s: another user owned prepaid ID is rejected before approval',async()=>{
 const f=await fixture();try{
  const foreign='d'.repeat(32);
  stmt(f.k.sql,"INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,'member_created',?,?)",
   foreign,hh,owner,'Other prepaid','prepaid',owner,owner);
  const r=await f.source(['points-actions'],f.intent('transfer_prepaid',{target_account_id:foreign}));
  assert.equal(r.status,409);
  assert.equal(r.data.code,'POINTS_PREPAID_TARGET_CHANGED');
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_intents').n,0);
  assert.equal(get(f.h.sql,'SELECT COUNT(*) n FROM household_approval_requests').n,0);
 }finally{f.close()}
});

test('two independent D1s: approved card payable offset debits points, reduces existing bill and creates no second expense',async()=>{
 const f=await fixture();try{
  const before=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const funding=await f.request(f.intent('earn_campaign',{units:700,yen_value:700}));
  assert.equal((await f.review(funding)).status,200);
  assert.equal((await f.execute(funding)).status,200);
  const offset=await f.request(f.intent('offset_card',{units:350,yen_value:350}));
  assert.equal((await f.review(offset)).status,200);
  const applied=await f.execute(offset);
  assert.equal(applied.status,200,JSON.stringify(applied));
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',offset).status,'applied');
  assert.equal(get(f.k.sql,'SELECT SUM(amount_jpy) n FROM family_points_card_offsets').n,350);
  assert.equal(get(f.k.sql,'SELECT remaining_after_jpy n FROM family_points_card_offsets').n,550);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,350);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,before);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
  assert.equal((await f.execute(offset)).data.replayed,true);
 }finally{f.close()}
});
test('two independent D1s: card offset commit with lost response reconciles original approval ID only',async()=>{
 const f=await fixture();try{
  const funding=await f.request(f.intent('earn_campaign',{units:450,yen_value:450}));
  assert.equal((await f.review(funding)).status,200);
  assert.equal((await f.execute(funding)).status,200);
  const offset=await f.request(f.intent('offset_card',{units:300,yen_value:300}));
  assert.equal((await f.review(offset)).status,200);
  const original=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const r=await original.fetch(req);
   if(r.status===200)throw Error('lost target receipt');
   return r;
  }};
  assert.notEqual((await f.execute(offset)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_card_offsets').n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=original;
  assert.equal((await f.execute(offset)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_card_offsets').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
 }finally{f.close()}
});

test('two isolated D1s: owner-approved points transfer/exchange conserves JPY and records immutable dual account credits',async()=>{
 const f=await fixture();try{
  const base=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const funding=await f.request(f.intent('earn_campaign',{units:450,yen_value:450}));
  assert.equal((await f.review(funding)).status,200);
  assert.equal((await f.execute(funding)).status,200);
  const transfer=await f.request(f.intent('transfer_out',
   {units:120,yen_value:120,target_units:120}));
  assert.equal((await f.review(transfer)).status,200);
  const sent=await f.execute(transfer);
  assert.equal(sent.status,200,JSON.stringify(sent));
  assert.equal(get(f.k.sql,'SELECT target_units n FROM family_points_transfer_credits WHERE homeflow_request_id=?',transfer).n,120);
  assert.equal(get(f.k.sql,'SELECT target_balance_after_units n FROM family_points_transfer_credits WHERE homeflow_request_id=?',transfer).n,120);
  const exchange=await f.request(f.intent('exchange_out',
   {units:100,yen_value:200,rate_numerator:2,rate_denominator:1,
    target_units:50,target_rate_numerator:4,target_rate_denominator:1}));
  assert.equal((await f.review(exchange)).status,200);
  const swapped=await f.execute(exchange);
  assert.equal(swapped.status,200,JSON.stringify(swapped));
  assert.equal(get(f.k.sql,'SELECT target_units n FROM family_points_transfer_credits WHERE homeflow_request_id=?',exchange).n,50);
  assert.equal(get(f.k.sql,'SELECT target_balance_after_units n FROM family_points_transfer_credits WHERE homeflow_request_id=?',exchange).n,170);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,230);
  assert.equal(get(f.k.sql,'SELECT SUM(target_units) n FROM family_points_transfer_credits WHERE target_account_id=?',receive).n,170);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,2);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,3);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,base);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
  assert.equal(get(f.h.sql,"SELECT COUNT(*) n FROM household_approval_requests WHERE status='applied'").n,3);
  const replay=await f.execute(exchange);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.data.replayed,true);
 }finally{f.close()}
});
test('two isolated D1s: lost response after target transfer COMMIT is retried with original approval and one credit',async()=>{
 const f=await fixture();try{
  const funding=await f.request(f.intent('earn_campaign',{units:220,yen_value:220}));
  assert.equal((await f.review(funding)).status,200);
  assert.equal((await f.execute(funding)).status,200);
  const transfer=await f.request(f.intent('transfer_out',
   {units:100,yen_value:100,target_units:100}));
  assert.equal((await f.review(transfer)).status,200);
  const original=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const r=await original.fetch(req);
   if(r.status===200)throw Error('target transfer committed; response lost');
   return r;
  }};
  assert.notEqual((await f.execute(transfer)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=original;
  const done=await f.execute(transfer);
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
 }finally{f.close()}
});

test('two isolated D1s: approved immutable reversal of erroneous earn and mistaken expiry uses original approval and no cash',async()=>{
 const f=await fixture();try{
  const initial=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const funding=await f.request(f.intent('earn_campaign',{units:160,yen_value:160}));
  assert.equal((await f.review(funding)).status,200);
  assert.equal((await f.execute(funding)).status,200);
  const expired=await f.request(f.intent('expire',{units:70,yen_value:70}));
  assert.equal((await f.review(expired)).status,200);
  assert.equal((await f.execute(expired)).status,200);
  const refund=await f.request(f.intent('reversal',{units:70,yen_value:70,original_request_id:expired}));
  assert.equal((await f.review(refund)).status,200);
  const done=await f.execute(refund);
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(get(f.k.sql,'SELECT delta_units n FROM family_points_journal WHERE reversed_request_id=?',expired).n,70);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,160);
  const cancel=await f.request(f.intent('reversal',{units:160,yen_value:160,original_request_id:funding}));
  assert.equal((await f.review(cancel)).status,200);
  assert.equal((await f.execute(cancel)).status,200);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,0);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,4);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,initial);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
  assert.equal((await f.execute(cancel)).data.replayed,true);
 }finally{f.close()}
});
test('two isolated D1s: reversal result lost after target COMMIT recovers exactly once by original ID',async()=>{
 const f=await fixture();try{
  const original=await f.request(f.intent('earn_campaign',{units:130,yen_value:130}));
  assert.equal((await f.review(original)).status,200);
  assert.equal((await f.execute(original)).status,200);
  const reverse=await f.request(f.intent('reversal',{units:130,yen_value:130,original_request_id:original}));
  assert.equal((await f.review(reverse)).status,200);
  const originalTransport=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const r=await originalTransport.fetch(req);
   if(r.status===200)throw Error('reversal already committed');
   return r;
  }};
  assert.notEqual((await f.execute(reverse)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_journal WHERE reversed_request_id=?',original).n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=originalTransport;
  assert.equal((await f.execute(reverse)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_journal WHERE reversed_request_id=?',original).n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
 }finally{f.close()}
});

test('two isolated D1s: HomeFlow-approved SBI point buy records exact fund units/cost with one points debit, no cash',async()=>{
 const f=await fixture();try{
  const originalEntries=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const earn=await f.request(f.intent('earn_campaign',{units:550,yen_value:550}));
  assert.equal((await f.review(earn)).status,200);
  assert.equal((await f.execute(earn)).status,200);
  const buy=await f.request(f.intent('redeem_asset',{
   units:240,yen_value:240,sbi_confirmed_units:1467}));
  assert.equal((await f.review(buy)).status,200);
  const done=await f.execute(buy);
  assert.equal(done.status,200,JSON.stringify(done));
  const p=get(f.k.sql,'SELECT * FROM family_sbi_point_lots WHERE homeflow_request_id=?',buy);
  assert.ok(p);
  assert.equal(p.owner_user_id,member);
  assert.equal(p.points_account_id,points);
  assert.equal(p.securities_account_id,securities);
  assert.equal(p.fund_code,'JP123456');
  assert.equal(p.account_type,'growth');
  assert.equal(p.confirmed_units,1467);
  assert.equal(p.acquisition_cost_jpy,240);
  assert.equal(p.total_units_after,1467);
  assert.equal(p.total_cost_after_jpy,240);
  assert.equal(p.evidence_kind,'user_attested_broker_execution');
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,310);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,originalEntries);
  assert.equal(get(f.k.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
  assert.equal(get(f.h.sql,"SELECT COUNT(*) n FROM household_approval_requests WHERE status='applied'").n,2);
  assert.equal((await f.execute(buy)).data.replayed,true);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,1);
 }finally{f.close()}
});
test('two isolated D1s: lost SBI point-lot receipt recovers with SAME original owner approval',async()=>{
 const f=await fixture();try{
  const earn=await f.request(f.intent('earn_campaign',{units:300,yen_value:300}));
  assert.equal((await f.review(earn)).status,200);
  assert.equal((await f.execute(earn)).status,200);
  const buy=await f.request(f.intent('redeem_asset',
   {units:150,yen_value:150,sbi_confirmed_units:987}));
  assert.equal((await f.review(buy)).status,200);
  const service=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const response=await service.fetch(req);
   if(response.status===200)throw Error('broker lot already recorded; lost transport reply');
   return response;
  }};
  assert.notEqual((await f.execute(buy)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=service;
  const resumed=await f.execute(buy);
  assert.equal(resumed.status,200,JSON.stringify(resumed));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,150);
 }finally{f.close()}
});

test('two isolated D1s: HomeFlow-approved transfer reversal restores sender and debits recipient atomically',async()=>{
 const f=await fixture();try{
  const originalEntries=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const earned=await f.request(f.intent('earn_campaign',{units:480,yen_value:480}));
  assert.equal((await f.review(earned)).status,200);
  assert.equal((await f.execute(earned)).status,200);
  const transferred=await f.request(f.intent('transfer_out',{
   units:140,yen_value:140,target_units:140}));
  assert.equal((await f.review(transferred)).status,200);
  assert.equal((await f.execute(transferred)).status,200);
  const refund=await f.request(f.intent('reversal',{
   units:140,yen_value:140,original_request_id:transferred}));
  assert.equal((await f.review(refund)).status,200);
  const done=await f.execute(refund);
  assert.equal(done.status,200,JSON.stringify(done));
  const r=get(f.k.sql,'SELECT * FROM family_points_transfer_refunds WHERE homeflow_request_id=?',refund);
  assert.ok(r);
  assert.equal(r.original_request_id,transferred);
  assert.equal(r.debited_target_units,140);
  assert.equal(r.target_balance_after_units,0);
  assert.equal(r.target_account_id,receive);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,480);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,originalEntries);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,3);
  assert.equal((await f.execute(refund)).data.replayed,true);
 }finally{f.close()}
});
test('two isolated D1s: spent target points cannot refund; lost reversal response recovers same signed immutable receipt',async()=>{
 const f=await fixture();try{
  const earned=await f.request(f.intent('earn_campaign',{units:300,yen_value:300}));
  assert.equal((await f.review(earned)).status,200);
  assert.equal((await f.execute(earned)).status,200);
  const transferred=await f.request(f.intent('transfer_out',{
   units:120,yen_value:120,target_units:120}));
  assert.equal((await f.review(transferred)).status,200);
  assert.equal((await f.execute(transferred)).status,200);
  const used=await f.request(f.intent('expire',{points_account_id:receive,units:40,yen_value:40}));
  assert.equal((await f.review(used)).status,200);
  assert.equal((await f.execute(used)).status,200);
  const rejected=await f.source(['points-actions'],f.intent('reversal',{
   units:120,yen_value:120,original_request_id:transferred}));
  assert.equal(rejected.status,409);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,0);
  const replenish=await f.request(f.intent('earn_campaign',{
   points_account_id:receive,units:50,yen_value:50}));
  assert.equal((await f.review(replenish)).status,200);
  assert.equal((await f.execute(replenish)).status,200);
  const refund=await f.request(f.intent('reversal',{
   units:120,yen_value:120,original_request_id:transferred}));
  assert.equal((await f.review(refund)).status,200);
  const service=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const response=await service.fetch(req);
   if(response.status===200)throw Error('target refund already committed');
   return response;
  }};
  assert.notEqual((await f.execute(refund)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=service;
  const done=await f.execute(refund);
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,5);
 }finally{f.close()}
});

test('two isolated D1s: approved points-prepaid refund atomically restores source and removes original prepaid credit',async()=>{
 const f=await fixture();try{
  const before=get(f.k.sql,'SELECT COUNT(*) n FROM entries').n;
  const earned=await f.request(f.intent('earn_campaign',{units:400,yen_value:400}));
  assert.equal((await f.review(earned)).status,200);
  assert.equal((await f.execute(earned)).status,200);
  const topup=await f.request(f.intent('transfer_prepaid',{units:120,yen_value:120}));
  assert.equal((await f.review(topup)).status,200);
  assert.equal((await f.execute(topup)).status,200);
  const compensation=await f.request(f.intent('reversal',{units:120,yen_value:120,
   original_request_id:topup}));
  assert.equal((await f.review(compensation)).status,200);
  const done=await f.execute(compensation);
  assert.equal(done.status,200,JSON.stringify(done));
  const audit=get(f.k.sql,'SELECT * FROM family_points_prepaid_refunds WHERE homeflow_request_id=?',compensation);
  assert.ok(audit);assert.equal(audit.original_request_id,topup);
  assert.equal(audit.points_account_id,points);assert.equal(audit.prepaid_account_id,prepaid);
  assert.equal(audit.debited_prepaid_jpy,120);assert.equal(audit.balance_after_jpy,0);
  assert.equal(get(f.k.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,400);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_refunds').n,1);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,3);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,before);
  assert.equal(get(f.h.sql,"SELECT COUNT(*) n FROM household_approval_requests WHERE status='applied'").n,3);
  assert.equal((await f.execute(compensation)).data.replayed,true);
 }finally{f.close()}
});
test('two isolated D1s: prepaid refund rejected when pre-existing credit is no longer spendable; lost reply recovers by original ID',async()=>{
 const f=await fixture();try{
  const earned=await f.request(f.intent('earn_campaign',{units:400,yen_value:400}));
  assert.equal((await f.review(earned)).status,200);
  assert.equal((await f.execute(earned)).status,200);
  const topup=await f.request(f.intent('transfer_prepaid',{units:140,yen_value:140}));
  assert.equal((await f.review(topup)).status,200);
  assert.equal((await f.execute(topup)).status,200);
  // Consumed prepaid JPY is NOT available for unconditional point restoration.
  const fakeBankDebit=f.k.sql.prepare("INSERT INTO family_prepaid_action_intents(request_id,household_id,requester_user_id,prepaid_account_id,prepaid_version,action,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,'spend',?,?,?,?,'submitted',?,?,?,?)");
  const now=Date.now(),spendId='8'.repeat(32),spendApproval='77777777-7777-4777-8777-777777777773';
  fakeBankDebit.run(spendId,hh,member,prepaid,1,'1'.repeat(64),'cipher','iv','2'.repeat(64),spendApproval,now-1000,now+86400000,now);
  const entry=stmt(f.k.sql,"INSERT INTO entries(date,amount,type,client_request_id,payment_source,family_account_id) VALUES('2026-11-14',50,'expense',?,?,?)",
   'hfprepaid:'+spendApproval,'prepaid:'+prepaid,prepaid).lastInsertRowid;
  stmt(f.k.sql,'INSERT INTO family_prepaid_actions_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,prepaid_account_id,prepaid_version,action,bank_account_id,bank_version,bank_reference_hash,payload_sha256,entry_id,amount_jpy,date,balance_after_jpy,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   spendApproval,spendId,hh,member,owner,owner,prepaid,1,'spend',null,null,null,'1'.repeat(64),Number(entry),50,'2026-11-14',90,now);
  stmt(f.k.sql,'INSERT INTO family_prepaid_balance_journal(homeflow_request_id,household_id,prepaid_account_id,delta_jpy,balance_after_jpy,effective_date,created_at) VALUES(?,?,?,?,?,?,?)',
   spendApproval,hh,prepaid,-50,90,'2026-11-14',now);
  const denied=await f.source(['points-actions'],f.intent('reversal',
   {units:140,yen_value:140,original_request_id:topup}));
  assert.equal(denied.status,409);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_refunds').n,0);
  const replenish=await f.request(f.intent('transfer_prepaid',{units:80,yen_value:80}));
  assert.equal((await f.review(replenish)).status,200);
  assert.equal((await f.execute(replenish)).status,200);
  const refund=await f.request(f.intent('reversal',
   {units:140,yen_value:140,original_request_id:topup}));
  assert.equal((await f.review(refund)).status,200);
  const originalService=f.home.KAKEIBO_POINTS_EXECUTION_SERVICE;
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE={async fetch(req){
   const response=await originalService.fetch(req);
   if(response.status===200)throw Error('prepaid reversal committed; transport lost');
   return response;
  }};
  assert.notEqual((await f.execute(refund)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_refunds').n,1);
  f.home.KAKEIBO_POINTS_EXECUTION_SERVICE=originalService;
  assert.equal((await f.execute(refund)).status,200);
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM family_points_prepaid_refunds').n,1);
 }finally{f.close()}
});
