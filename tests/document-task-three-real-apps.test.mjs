import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto,createHmac} from 'node:crypto';
import {documentApprovalSubmissionRoute} from '../worker/document-approval-submission.js';
import {approvalRoute} from '../worker/approvals.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {documentApprovalStatusRoute} from '../worker/document-approval-status.js';
import {documentTaskSourceRoute} from '../.contract-document/worker/document-task-source.js';
import {documentMemberApprovalStatus} from '../.contract-document/worker/document-member-approval.js';
import {sealDocumentIntent} from '../.contract-document/worker/document-intent-crypto.js';
import {hashString} from '../.contract-document/worker/security.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hurl='https://homeflow.example.test';
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const hh='primary',candidate='a'.repeat(32),documentId='b'.repeat(32);
const keys={submit:'d'.repeat(64),proof:'3'.repeat(64),
 execute:'2'.repeat(64),approval:'e'.repeat(64),cipher:'1'.repeat(64)};
const task=()=>({operation:'task',title:'家庭待办·配送確認',
 dueOn:'2026-11-19',visibility:'household',assignee:null,
 bonusPoints:0,remindEnabled:true});
const sign=(domain,secret,stamp,raw)=>createHmac('sha256',Buffer.from(secret,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex');
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 const db={prepare(stmt){return{bind(...a){return{
  first:async()=>sql.prepare(stmt).get(...a)||null,
  all:async()=>({results:sql.prepare(stmt).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(stmt).run(...a).changes}}),
  sync:()=>({meta:{changes:sql.prepare(stmt).run(...a).changes}})
 }}}},async batch(stmts){
  sql.exec('BEGIN IMMEDIATE');
  try{const result=stmts.map(s=>s.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 return {sql,db};
}
const homeMigrations=()=>{
 const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
  .match(/MIGRATIONS=\[([\s\S]*?)\]/)[1]
  .match(/"[^"]+\.sql"/g).map(s=>s.slice(1,-1));
 assert.ok(manifest.includes('0056_document_task_apply.sql'));
 return manifest;
};
async function fixture(){
 const h=database(),d=database();
 for(const name of homeMigrations())h.sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 for(const name of ['0001_init.sql','0003_password_auth.sql','0020_homeflow_identity_links.sql',
  '0021_homeflow_sso_pending.sql','0022_homeflow_session_proofs.sql',
  '0023_document_member_sync_intents.sql','0024_document_execution_reservation.sql',
  '0025_document_task_execution_reservation.sql'])
  d.sql.exec(readFileSync(new URL('../.contract-document/migrations/'+name,import.meta.url),'utf8'));
 h.sql.prepare('INSERT INTO households(id,display_name) VALUES(?,?)').run(hh,'Home');
 h.sql.prepare('INSERT INTO households(id,display_name) VALUES(?,?)').run('other-household','Other');
 for(const [id,role,house] of [[owner,'owner',hh],[member,'member',hh],[other,'owner','other-household']]){
  h.sql.prepare('INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)')
   .run(id,id,'salt','verifier');
  h.sql.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
   .run(house,id,role);
 }
 const now=new Date().toISOString();
 d.sql.prepare('INSERT INTO households(id,name,created_at,updated_at) VALUES(?,?,?,?)')
  .run('local','Home',now,now);
 for(const [id,hfid,role] of [['local-member',member,'member'],['local-owner',owner,'owner']]){
  d.sql.prepare('INSERT INTO users(id,household_id,email_norm,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .run(id,'local',id+'@test.invalid',id,role,now,now);
  d.sql.prepare('INSERT INTO homeflow_identity_links(homeflow_user_id,homeflow_household_id,local_user_id,verified_at) VALUES(?,?,?,?)')
   .run(hfid,hh,id,now);
 }
 d.sql.prepare('INSERT INTO documents(id,owner_id,household_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run(documentId,'local-member','local','Private document title must never appear in HomeFlow approval',now,now);
 d.sql.prepare('INSERT INTO action_candidates(id,document_id,candidate_kind,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run(candidate,documentId,'homeflow_task',
   JSON.stringify({task_type:'deadline',title:'配送確認',due_on:'2026-11-19'}),now,now);
 const snapshot=JSON.stringify({source_document_id:documentId,source_candidate_id:candidate,
  source_document_version:1,candidate_updated_at:now,candidate_kind:'homeflow_task',
  homeflow_user_id:member,homeflow_household_id:hh,target_app:'homeflow',payload:task()});
 const digest=await hashString(snapshot);
 const home={DB:h.db,APP_ENV:'production',APPROVALS_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  DOCUMENT_TASK_EXECUTION_ENABLED:'true',DOCUMENT_APPROVAL_SUBMISSION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_SECRET:keys.submit,
  DOCUMENT_APPROVAL_VERIFICATION_SECRET:keys.proof,
  DOCUMENT_EXECUTION_SECRET:keys.execute,
  APPROVAL_VERIFICATION_SECRET:keys.approval};
 const doc={DB:d.db,APP_ENV:'production',HOMEFLOW_SSO_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_SECRET:keys.submit,
  DOCUMENT_TASK_EXECUTION_ENABLED:'true',
  HOMEFLOW_DOCUMENT_EXECUTION_SECRET:keys.execute,
  DOCUMENT_APPROVAL_VERIFICATION_SECRET:keys.proof,
  DOCUMENT_INTENT_ENCRYPTION_KEY:keys.cipher};
 const identity={candidate_id:candidate,document_id:documentId,local_user_id:'local-member',
  homeflow_user_id:member,homeflow_household_id:hh,target_app:'homeflow',
  candidate_kind:'homeflow_task',document_version:1,candidate_updated_at:now,
  payload_sha256:digest};
 const enc=await sealDocumentIntent(doc,identity,snapshot);
 d.sql.prepare('INSERT INTO document_member_sync_intents (candidate_id,document_id,'+
  'local_user_id,homeflow_user_id,homeflow_household_id,target_app,candidate_kind,'+
  'document_version,candidate_updated_at,payload_sha256,payload_cipher,payload_iv,'+
  "status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)")
 .run(candidate,documentId,'local-member',member,hh,'homeflow','homeflow_task',1,now,
  digest,enc.payload_cipher,enc.payload_iv,now,now);
 const counters={prepare:0,receipt:0,verify:0};
 home.DOCUMENT_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  counters[mode]++;
  return documentTaskSourceRoute(req,doc,mode);
 }};
 doc.HOMEFLOW_BRIDGE_SERVICE={async fetch(req){
  if(new URL(req.url).pathname==='/api/internal/approvals/document-status')
   return documentApprovalStatusRoute(req,home);
  counters.verify++;
  return approvalVerificationRoute(req,home);
 }};
 const wire={household_id:hh,requester_user_id:member,
  resource_id:candidate,payload_sha256:digest,target_app:'homeflow'};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 const sent=await documentApprovalSubmissionRoute(new Request(
  hurl+'/api/internal/approvals/document-submit',{method:'POST',headers:{
   'content-type':'application/json','x-approval-client':'jp-document-assistant',
   'x-approval-timestamp':stamp,'x-approval-signature':sign('jp-document-assistant',keys.submit,stamp,raw)
  },body:raw}),home);
 assert.equal(sent.status,201,await sent.clone().text());
 const id=(await sent.json()).approval_id;
 d.sql.prepare("UPDATE document_member_sync_intents SET status='submitted',approval_id=? WHERE candidate_id=?")
  .run(id,candidate);
 const ownerSession={household_id:hh,user_id:owner,role:'owner'};
 const memberSession={household_id:hh,user_id:member,role:'member'};
 const memberDoc={user_id:'local-member',household_id:'local',role:'member',
  auth_source:'homeflow',homeflow_user_id:member,homeflow_household_id:hh};
 const review=async()=>{
  const path='/api/approvals/'+id+'/review';
  return approvalRoute(new Request(hurl+path,{method:'POST',
   headers:{'content-type':'application/json',origin:hurl},body:'{"decision":"approve"}'}),
   home,path,ownerSession);
 };
 const execute=async()=>{
  const path='/api/approvals/'+id+'/execute';
  const r=await approvalExecutionRoute(new Request(hurl+path,{method:'POST',
   headers:{'content-type':'application/json',origin:hurl},body:'{}'}),home,path,ownerSession);
  return {status:r.status,data:await r.json()};
 };
 const documentStatus=async()=>documentMemberApprovalStatus(doc,memberDoc,candidate);
 return {h,d,home,doc,digest,id,review,execute,documentStatus,counters,
  close(){h.sql.close();d.sql.close()}};
}
test('real approved document task: signed source, HomeFlow D1 insert/journal/actor, source receipt, two app status',async()=>{
 const f=await fixture();
 try{
  const initial=await f.documentStatus();
  assert.equal(initial.status,200);
  assert.equal((await initial.json()).applied,false);
  assert.equal((await f.review()).status,200);
  const before=await f.documentStatus();
  assert.equal(before.status,200);
  assert.equal((await before.json()).applied,false);
  const executed=await f.execute();
  assert.equal(executed.status,200,JSON.stringify(executed));
  assert.equal(executed.data.applied,true);
  assert.equal(executed.data.source_receipt_confirmed,true);
  const target=f.h.sql.prepare('SELECT * FROM tasks').get();
  assert.equal(target.id,executed.data.remote_id);
  assert.equal(target.creator_user_id,member);
  assert.equal(target.household_id,hh);
  assert.equal(target.title,task().title);
  assert.equal(target.visibility,'household');
  assert.equal(target.remind_enabled,1);
  assert.equal(target.completed_at,null);
  const journal=f.h.sql.prepare('SELECT * FROM document_task_applied_actions').get();
  assert.equal(journal.task_id,target.id);
  assert.equal(journal.requester_user_id,member);
  assert.equal(journal.approver_user_id,owner);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'applied');
  const audit=f.h.sql.prepare("SELECT actor_user_id FROM household_approval_events WHERE action='applied'").get();
  assert.equal(audit.actor_user_id,owner);
  const sourceReceipt=f.d.sql.prepare('SELECT * FROM document_task_execution_reservations').get();
  assert.equal(sourceReceipt.status,'applied');
  assert.equal(sourceReceipt.task_id,target.id);
  assert.equal(f.d.sql.prepare('SELECT actor_user_id FROM audit_events').get().actor_user_id,'local-owner');
  const sourceStatus=await f.documentStatus();
  assert.equal(sourceStatus.status,200,await sourceStatus.clone().text());
  const stat=await sourceStatus.json();
  assert.equal(stat.applied,true);
  assert.equal(stat.target_changed,true);
  assert.equal(stat.task_id,target.id);
  const replay=await f.execute();
  assert.equal(replay.status,200);
  assert.equal(replay.data.replayed,true);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM document_task_applied_actions').get().n,1);
  assert.equal(f.d.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
  assert.equal(f.counters.prepare,1,'replayed approval never runs another task prepare');
  assert.equal(JSON.stringify(f.h.sql.prepare('SELECT * FROM household_approval_requests').get()).includes('Private document title'),false);
 }finally{f.close()}
});
test('lost source acknowledgement after target transaction: owner replay only repairs source, not task',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  const real=f.home.DOCUMENT_EXECUTION_SERVICE;
  f.home.DOCUMENT_EXECUTION_SERVICE={async fetch(req){
   if(new URL(req.url).pathname.endsWith('/receipt'))throw Error('simulated source acknowledgement network loss');
   return real.fetch(req);
  }};
  const first=await f.execute();
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.data.applied,true);
  assert.equal(first.data.source_receipt_confirmed,false);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
  assert.equal(f.d.sql.prepare('SELECT status FROM document_task_execution_reservations').get().status,'executing');
  const pending=await f.documentStatus();
  assert.equal(pending.status,503);
  f.home.DOCUMENT_EXECUTION_SERVICE=real;
  const replay=await f.execute();
  assert.equal(replay.status,200);
  assert.equal(replay.data.replayed,true);
  assert.equal(replay.data.source_receipt_confirmed,true);
  const applied=await f.documentStatus();
  assert.equal(applied.status,200,await applied.clone().text());
  assert.equal((await applied.json()).applied,true);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
  assert.equal(f.d.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
 }finally{f.close()}
});
test('source document revoked before actual owner execution creates no task',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  f.d.sql.prepare("UPDATE homeflow_identity_links SET state='revoked',revoked_at=? WHERE homeflow_user_id=?")
   .run(new Date().toISOString(),member);
  const rejected=await f.execute();
  assert.equal(rejected.data.applied,false);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  assert.equal(f.d.sql.prepare('SELECT COUNT(*) n FROM document_task_execution_reservations').get().n,0);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'failed_retryable');
 }finally{f.close()}
});
test('two HomeFlow owner devices racing one approval cannot create a duplicate task',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  const both=await Promise.all([f.execute(),f.execute()]);
  assert.ok(both.some(r=>r.status===200),JSON.stringify(both));
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM document_task_applied_actions').get().n,1);
  assert.equal(f.d.sql.prepare('SELECT COUNT(*) n FROM document_task_execution_reservations').get().n,1);
  assert.equal((await f.execute()).data.applied,true);
 }finally{f.close()}
});
test('document task identity feature switches default OFF in every executing app',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  f.doc.DOCUMENT_TASK_EXECUTION_ENABLED='false';
  const offDoc=await f.execute();
  assert.equal(offDoc.data.applied,false);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  f.doc.DOCUMENT_TASK_EXECUTION_ENABLED='true';
  f.home.DOCUMENT_TASK_EXECUTION_ENABLED='false';
  assert.equal((await f.execute()).data.applied,false);
  assert.equal(f.h.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
 }finally{f.close()}
});
