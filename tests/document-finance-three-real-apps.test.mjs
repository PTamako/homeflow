// Cross-repository finance P0: real HomeFlow, Document Assistant and Kakeibo
// route handlers, separate in-memory SQLite stores and signed Service Bindings.
// No Cloudflare deployment, production data, secrets or network are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac, webcrypto} from 'node:crypto';
import {documentApprovalSubmissionRoute} from '../worker/document-approval-submission.js';
import {approvalRoute} from '../worker/approvals.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {documentExecutionRoute} from '../.contract-document/worker/document-execution.js';
import {sealDocumentIntent} from '../.contract-document/worker/document-intent-crypto.js';
import {hashString} from '../.contract-document/worker/security.js';
import {documentFinanceRoute} from '../.contract-kakeibo/functions/api/internal/document-finance/[[path]].js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;
const home='https://homeflow.example.test';
const member='22222222-2222-4222-8222-222222222222';
const owner='11111111-1111-4111-8111-111111111111';
const household='primary',localMember='local-member',localOwner='local-owner';
const candidate='a'.repeat(32),docId='b'.repeat(32),account='c'.repeat(32);
const keys={submit:'d'.repeat(64),proof:'e'.repeat(64),
 documentProof:'3'.repeat(64),execute:'2'.repeat(64),
 target:'4'.repeat(64),cipher:'1'.repeat(64)};
const base=new URL('../',import.meta.url);
function sqliteFixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 const db={
  prepare(query){return{bind(...params){return{
   first:async()=>sql.prepare(query).get(...params)||null,
   all:async()=>({results:sql.prepare(query).all(...params)}),
   run:async()=>({meta:{changes:sql.prepare(query).run(...params).changes}}),
   sync:()=>({meta:{changes:sql.prepare(query).run(...params).changes}})
  }}}},
  async batch(statements){
   sql.exec('BEGIN IMMEDIATE');
   try{
    const result=statements.map(s=>s.sync());
    sql.exec('COMMIT');return result;
   }catch(e){sql.exec('ROLLBACK');throw e}
  }
 };
 return {sql,db};
}
function migrate(sql,root,files){
 for(const file of files)sql.exec(readFileSync(new URL(root+'/migrations/'+file,base),'utf8'));
}
function signed(url,body,client,domain,key,options={}){
 const raw=JSON.stringify(body),stamp=String(Date.now());
 const signature=createHmac('sha256',Buffer.from(key,'hex'))
  .update(domain+'\n'+stamp+'\n'+raw).digest('hex');
 return new Request(url,{method:'POST',headers:{
  'content-type':'application/json','x-approval-client':client,
  'x-approval-timestamp':stamp,'x-approval-signature':options.badSignature?
   '0'.repeat(64):signature,
  ...(options.browser?{origin:'https://attacker.invalid'}:{})
 },body:raw});
}
async function fixture(){
 const h=sqliteFixture(),d=sqliteFixture(),k=sqliteFixture();
 h.sql.exec("CREATE TABLE households(id TEXT PRIMARY KEY);"+
  "CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);"+
  "CREATE TABLE household_members(household_id TEXT NOT NULL REFERENCES households(id),"+
  "user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,"+
  "PRIMARY KEY(household_id,user_id));");
 h.sql.prepare('INSERT INTO households(id) VALUES(?)').run(household);
 h.sql.prepare('INSERT INTO households(id) VALUES(?)').run('other-household');
 for(const [id,role,hh] of [[owner,'owner',household],
  [member,'member',household],['outsider','owner','other-household']]){
  h.sql.prepare('INSERT INTO users(id) VALUES(?)').run(id);
  h.sql.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
   .run(hh,id,role);
 }
 migrate(h.sql,'.',['0054_household_approval_core.sql',
  '0055_household_approval_execution_lease.sql']);
 migrate(d.sql,'.contract-document',['0001_init.sql','0003_password_auth.sql',
  '0020_homeflow_identity_links.sql','0021_homeflow_sso_pending.sql',
  '0022_homeflow_session_proofs.sql','0023_document_member_sync_intents.sql',
  '0024_document_execution_reservation.sql']);
 migrate(k.sql,'.contract-kakeibo',['0001_support_tables.sql',
  '0002_versioned_migration_tracking.sql','0022_homeflow_identity_foundation.sql',
  '0023_family_financial_account_identities.sql',
  '0024_family_finance_pending_actions.sql']);
 k.sql.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT)');
 migrate(k.sql,'.contract-kakeibo',['0030_document_finance_execution.sql']);
 const now=new Date().toISOString();
 d.sql.prepare('INSERT INTO households(id,name,created_at,updated_at) VALUES(?,?,?,?)')
  .run('local','Home',now,now);
 for(const [local,hf,role] of [[localMember,member,'member'],
  [localOwner,owner,'owner']]){
  d.sql.prepare('INSERT INTO users(id,household_id,email_norm,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .run(local,'local',local+'@test.invalid',local,role,now,now);
  d.sql.prepare('INSERT INTO homeflow_identity_links(homeflow_user_id,homeflow_household_id,local_user_id,verified_at) VALUES(?,?,?,?)')
   .run(hf,household,local,now);
  k.sql.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
   .run(hf,household,role,role,'active',Date.now());
 }
 k.sql.prepare('INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)')
  .run(account,household,member,'同名现金','cash','member_created',member,member);
 k.sql.prepare('INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)')
  .run('f'.repeat(32),household,member,'同名现金','cash','member_created',member,member);
 d.sql.prepare('INSERT INTO documents(id,owner_id,household_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run(docId,localMember,'local','PRIVATE DOCUMENT MUST NOT LEAK',now,now);
 d.sql.prepare('INSERT INTO action_candidates(id,document_id,candidate_kind,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run(candidate,docId,'finance',JSON.stringify({kind:'expense'}),now,now);
 const payload={operation:'entry',type:'expense',date:'2026-11-14',
  amount:1420,category:'食費',merchant:'コンビニ',note:'private note',
  paymentSource:'同名现金',source_kind:'document_assistant',
  account_id:account,account_version:1,account_kind:'cash'};
 const snapshot=JSON.stringify({source_document_id:docId,
  source_candidate_id:candidate,source_document_version:1,
  candidate_updated_at:now,candidate_kind:'finance',homeflow_user_id:member,
  homeflow_household_id:household,target_app:'kakebo',payload});
 const digest=await hashString(snapshot);
 const hfEnv={DB:h.db,APP_ENV:'production',APPROVALS_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_ENABLED:'true',DOCUMENT_EXECUTION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_SECRET:keys.submit,
  APPROVAL_VERIFICATION_SECRET:keys.proof,
  DOCUMENT_APPROVAL_VERIFICATION_SECRET:keys.documentProof,
  DOCUMENT_EXECUTION_SECRET:keys.execute};
 const docEnv={DB:d.db,APP_ENV:'production',DOCUMENT_EXECUTION_ENABLED:'true',
  DOCUMENT_INTENT_ENCRYPTION_KEY:keys.cipher,
  HOMEFLOW_DOCUMENT_EXECUTION_SECRET:keys.execute,
  DOCUMENT_APPROVAL_VERIFICATION_SECRET:keys.documentProof,
  DOCUMENT_FINANCE_TARGET_SECRET:keys.target};
 const kEnv={DB:k.db,APP_ENV:'production',
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_DOCUMENT_FINANCE_EXECUTION_ENABLED:'true',
  KAKEIBO_APPROVAL_PROOF_ENABLED:'true',
  KAKEIBO_DOCUMENT_FINANCE_SECRET:keys.target,
  KAKEIBO_APPROVAL_VERIFICATION_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:home};
 const identity={candidate_id:candidate,document_id:docId,local_user_id:localMember,
  homeflow_user_id:member,homeflow_household_id:household,target_app:'kakebo',
  candidate_kind:'finance',document_version:1,candidate_updated_at:now,
  payload_sha256:digest};
 const cipher=await sealDocumentIntent(docEnv,identity,snapshot);
 d.sql.prepare('INSERT INTO document_member_sync_intents (candidate_id,document_id,'+
  'local_user_id,homeflow_user_id,homeflow_household_id,target_app,candidate_kind,'+
  'document_version,candidate_updated_at,payload_sha256,payload_cipher,payload_iv,'+
  'status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'+
  "'prepared',?,?)")
  .run(candidate,docId,localMember,member,household,'kakebo','finance',1,
   now,digest,cipher.payload_cipher,cipher.payload_iv,now,now);
 const counters={verification:0,source:0,target:0};
 hfEnv.DOCUMENT_EXECUTION_SERVICE={async fetch(req){
  return documentExecutionRoute(req,docEnv,new URL(req.url).pathname.split('/').at(-1));
 }};
 docEnv.HOMEFLOW_BRIDGE_SERVICE={async fetch(req){
  counters.verification++;return approvalVerificationRoute(req,hfEnv);
 }};
 kEnv.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  counters.verification++;return approvalVerificationRoute(req,hfEnv);
 }};
 docEnv.KAKEIBO_DOCUMENT_FINANCE_SERVICE={async fetch(req){
  counters.target++;return documentFinanceRoute(req,kEnv,[new URL(req.url).pathname.split('/').at(-1)]);
 }};
 kEnv.DOCUMENT_FINANCE_SOURCE_SERVICE={async fetch(req){
  counters.source++;return documentExecutionRoute(req,docEnv,'source-check');
 }};
 const submitBody={household_id:household,requester_user_id:member,
  resource_id:candidate,payload_sha256:digest,target_app:'kakebo'};
 const submission=await documentApprovalSubmissionRoute(
  signed(home+'/api/internal/approvals/document-submit',submitBody,
   'jp-document-assistant','jp-document-assistant',keys.submit),hfEnv);
 assert.equal(submission.status,201,await submission.clone().text());
 const submitted=await submission.json(),approvalId=submitted.approval_id;
 assert.equal(submitted.applied,false);
 assert.equal(h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'pending');
 assert.equal(k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
 d.sql.prepare("UPDATE document_member_sync_intents SET status='submitted',approval_id=?,updated_at=? WHERE candidate_id=?")
  .run(approvalId,now,candidate);
 const ownerSession={user_id:owner,household_id:household,role:'owner'};
 async function review(){
  const path='/api/approvals/'+approvalId+'/review';
  return approvalRoute(new Request(home+path,{
   method:'POST',headers:{'content-type':'application/json',origin:home},
   body:JSON.stringify({decision:'approve'})}),hfEnv,path,ownerSession);
 }
 async function execute(){
  const path='/api/approvals/'+approvalId+'/execute';
  const result=await approvalExecutionRoute(new Request(home+path,{
   method:'POST',headers:{'content-type':'application/json',origin:home},
   body:'{}'}),hfEnv,path,ownerSession);
  return {status:result.status,body:await result.json()};
 }
 return {h,d,k,hfEnv,docEnv,kEnv,counters,digest,approvalId,review,execute,
  close(){h.sql.close();d.sql.close();k.sql.close()}};
}
test('real three-app chain: member submits, owner approves, leased signed execution atomically posts and replays',async()=>{
 const f=await fixture();
 try{
  const premature=await f.execute();
  assert.equal(premature.status,404,'pending approval is concealed until reviewed');
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
  const reviewed=await f.review();
  assert.equal(reviewed.status,200,await reviewed.clone().text());
  assert.equal((await reviewed.json()).request.status,'approved');
  const applied=await f.execute();
  assert.equal(applied.status,200,JSON.stringify(applied.body));
  assert.equal(applied.body.applied,true);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  assert.equal(f.k.sql.prepare('SELECT family_account_id FROM entries').get().family_account_id,account);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM document_finance_applied_actions').get().n,1);
  assert.equal(f.k.sql.prepare('SELECT actor_user_id FROM family_finance_events').get().actor_user_id,owner);
  assert.equal(f.d.sql.prepare('SELECT COUNT(*) n FROM document_member_execution_reservations WHERE status=?').get('applied').n,1);
  assert.equal(f.d.sql.prepare('SELECT actor_user_id FROM audit_events WHERE kind=?').get('document_sync_applied_by_approver').actor_user_id,localOwner);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'applied');
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM household_approval_events WHERE action=?').get('applied').n,1);
  const replay=await f.execute();
  assert.equal(replay.status,200);
  assert.equal(replay.body.replayed,true);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  assert.equal(f.counters.source,1);
  assert.equal(f.counters.target,1);
  const privateApproval=f.h.sql.prepare('SELECT * FROM household_approval_requests').get();
  assert.equal(JSON.stringify(privateApproval).includes('PRIVATE DOCUMENT'),false);
  assert.equal(JSON.stringify(privateApproval).includes('private note'),false);
 }finally{f.close()}
});
test('lost remote response: target committed, same request id reconciles without a second entry',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  const original=f.hfEnv.DOCUMENT_EXECUTION_SERVICE;
  f.hfEnv.DOCUMENT_EXECUTION_SERVICE={async fetch(req){
   await original.fetch(req);throw new Error('simulated response loss');
  }};
  const lost=await f.execute();
  assert.equal(lost.status,503);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'failed_retryable');
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  f.hfEnv.DOCUMENT_EXECUTION_SERVICE=original;
  const retry=await f.execute();
  assert.equal(retry.status,200,JSON.stringify(retry.body));
  assert.equal(retry.body.applied,true);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'applied');
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM document_finance_applied_actions').get().n,1);
  assert.equal(f.d.sql.prepare('SELECT COUNT(*) n FROM audit_events WHERE kind=?').get('document_sync_applied_by_approver').n,1);
 }finally{f.close()}
});
test('revoked document source and changed stable account version both prevent target mutation',async()=>{
 for(const scenario of ['revoked','account-version','disabled-member']){
  const f=await fixture();
  try{
   assert.equal((await f.review()).status,200);
   if(scenario==='revoked')f.d.sql.prepare("UPDATE homeflow_identity_links SET state='revoked',revoked_at=? WHERE homeflow_user_id=?")
    .run(new Date().toISOString(),member);
   if(scenario==='account-version')f.k.sql.prepare('UPDATE family_financial_accounts SET version=2 WHERE account_id=?').run(account);
   if(scenario==='disabled-member')f.h.sql.prepare('UPDATE users SET disabled_at=? WHERE id=?')
    .run(Date.now(),member);
   const rejected=await f.execute();
   assert.equal(rejected.body.applied,false,scenario);
   assert.notEqual(rejected.status,200,scenario);
   assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0,scenario);
   assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM document_finance_applied_actions').get().n,0,scenario);
  }finally{f.close()}
 }
});
test('flags off in each app and tampered backend signature fail closed',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  f.hfEnv.DOCUMENT_EXECUTION_ENABLED='false';
  assert.equal((await f.execute()).body.applied,false);
  f.hfEnv.DOCUMENT_EXECUTION_ENABLED='true';
  f.docEnv.DOCUMENT_EXECUTION_ENABLED='false';
  assert.equal((await f.execute()).body.applied,false);
  f.docEnv.DOCUMENT_EXECUTION_ENABLED='true';
  const forged=signed('https://kakeibo.internal/api/internal/document-finance/execute',
   {request_id:f.approvalId},'jp-document-assistant','jpda:finance-execute',
   keys.target,{badSignature:true});
  const denied=await documentFinanceRoute(forged,f.kEnv,['execute']);
  assert.equal(denied.status,403);
  assert.equal(f.k.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
 }finally{f.close()}
});
test('additive Kakeibo 0023/0024/0030 and document 0023/0024 replay without index or data loss',async()=>{
 const f=await fixture();
 try{
  migrate(f.k.sql,'.contract-kakeibo',['0023_family_financial_account_identities.sql',
   '0024_family_finance_pending_actions.sql','0030_document_finance_execution.sql']);
  migrate(f.d.sql,'.contract-document',['0023_document_member_sync_intents.sql',
   '0024_document_execution_reservation.sql']);
  assert.equal(f.k.sql.prepare("SELECT COUNT(*) n FROM family_financial_accounts").get().n,2);
  assert.equal(f.d.sql.prepare("SELECT COUNT(*) n FROM document_member_sync_intents").get().n,1);
  assert.equal(f.k.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_document_finance_applied_household'").get().n,1);
 }finally{f.close()}
});

test('household identity is immutable in the Kakeibo database itself',async()=>{
 const f=await fixture();
 try{
  assert.throws(()=>f.k.sql.prepare('UPDATE homeflow_identity_links SET household_id=? WHERE user_id=?')
   .run('other-household',member),/immutable HomeFlow identity/);
  assert.equal(f.k.sql.prepare('SELECT household_id FROM homeflow_identity_links WHERE user_id=?').get(member).household_id,household);
 }finally{f.close()}
});
