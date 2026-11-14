// Real three-repository processors in one isolated Node process:
// HomeFlow lease -> Document Assistant AES-GCM source and durable reservation ->
// Study private D1 target + immutable journal -> exact source receipt -> HomeFlow applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto,createHmac} from 'node:crypto';
import {documentApprovalSubmissionRoute} from '../worker/document-approval-submission.js';
import {approvalRoute} from '../worker/approvals.js';
import {approvalExecutionRoute} from '../worker/approval-execution.js';
import {approvalVerificationRoute} from '../worker/approval-verification.js';
import {documentApprovalStatusRoute} from '../worker/document-approval-status.js';
import {documentStudySourceRoute} from '../.contract-document/worker/document-study-source.js';
import {documentMemberApprovalStatus} from '../.contract-document/worker/document-member-approval.js';
import {sealDocumentIntent} from '../.contract-document/worker/document-intent-crypto.js';
import {hashString} from '../.contract-document/worker/security.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const dir=mkdtempSync(join(tmpdir(),'three-app-document-study-'));
writeFileSync(join(dir,'document-study-apply.mts'),
 readFileSync(new URL('../.contract-study/worker/document-study-apply.ts',import.meta.url),'utf8'));
writeFileSync(join(dir,'document-study-execution.mts'),
 readFileSync(new URL('../.contract-study/worker/document-study-execution.ts',import.meta.url),'utf8')
  .replace("'./document-study-apply'","'./document-study-apply.mts'"));
const {documentStudyExecution}=await import(pathToFileURL(join(dir,'document-study-execution.mts')));
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const hurl='https://homeflow.example.test',hh='primary';
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const candidate='a'.repeat(32),documentId='b'.repeat(32);
const keys={submit:'1'.repeat(64),sourceProof:'2'.repeat(64),
 studyProof:'3'.repeat(64),studyExecutor:'4'.repeat(64),
 homeStudy:'5'.repeat(64),studySource:'6'.repeat(64),
 cipher:'7'.repeat(64),cash:'8'.repeat(64)};
const word={operation:'vocabulary',language:'ja',term:'確認',reading:'かくにん',
 meaning_zh:'确认',skip_existing:true};
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
  try{const list=stmts.map(s=>s.sync());sql.exec('COMMIT');return list}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 return {sql,db};
}
const homeMigrations=()=>readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
 .match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g).map(x=>x.slice(1,-1));
async function fixture(){
 const h=database(),d=database(),s=database();
 for(const name of homeMigrations())
  h.sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 for(const name of ['0001_init.sql','0003_password_auth.sql',
  '0020_homeflow_identity_links.sql','0021_homeflow_sso_pending.sql',
  '0022_homeflow_session_proofs.sql','0023_document_member_sync_intents.sql',
  '0024_document_execution_reservation.sql','0025_document_task_execution_reservation.sql',
  '0026_document_study_execution_reservation.sql'])
  d.sql.exec(readFileSync(new URL('../.contract-document/migrations/'+name,import.meta.url),'utf8'));
 for(const name of ['0180_homeflow_identity_isolation.sql',
  '0181_homeflow_user_vocabulary.sql','0190_homeflow_personal_sentence_cards.sql',
  '0191_homeflow_document_study_receipts.sql','0192_homeflow_document_study_approver_audit.sql'])
  s.sql.exec(readFileSync(new URL('../.contract-study/migrations/'+name,import.meta.url),'utf8'));
 h.sql.prepare('INSERT INTO households(id,display_name) VALUES(?,?)').run(hh,'Home');
 for(const [id,role] of [[owner,'owner'],[member,'member']]){
  h.sql.prepare('INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)')
   .run(id,id,'salt','verifier');
  h.sql.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
   .run(hh,id,role);
  s.sql.prepare('INSERT INTO homeflow_identity_links '+
   '(homeflow_user_id,homeflow_household_id,role,display_name,state,profile_version) '+
   "VALUES(?,?,?,?,'active',1)")
   .run(id,hh,role,id);
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
  .run(documentId,'local-member','local','Private document, do not send to HomeFlow',now,now);
 d.sql.prepare('INSERT INTO action_candidates(id,document_id,candidate_kind,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run(candidate,documentId,'vocabulary',JSON.stringify({term:word.term}),now,now);
 const snapshot=JSON.stringify({source_document_id:documentId,source_candidate_id:candidate,
  source_document_version:1,candidate_updated_at:now,candidate_kind:'vocabulary',
  homeflow_user_id:member,homeflow_household_id:hh,target_app:'it-study-platform',payload:word});
 const digest=await hashString(snapshot);
 const home={DB:h.db,APP_ENV:'production',APPROVALS_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  DOCUMENT_STUDY_EXECUTION_ENABLED:'true',DOCUMENT_APPROVAL_SUBMISSION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_SECRET:keys.submit,
  DOCUMENT_APPROVAL_VERIFICATION_SECRET:keys.sourceProof,
  STUDY_APPROVAL_VERIFICATION_SECRET:keys.studyProof,
  DOCUMENT_STUDY_EXECUTION_SECRET:keys.homeStudy,
  APPROVAL_VERIFICATION_SECRET:keys.cash};
 const doc={DB:d.db,APP_ENV:'production',HOMEFLOW_SSO_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_SECRET:keys.submit,
  DOCUMENT_STUDY_EXECUTION_ENABLED:'true',
  HOMEFLOW_STUDY_EXECUTION_SECRET:keys.homeStudy,
  DOCUMENT_APPROVAL_VERIFICATION_SECRET:keys.sourceProof,
  DOCUMENT_STUDY_TARGET_SECRET:keys.studyExecutor,
  STUDY_DOCUMENT_SOURCE_SECRET:keys.studySource,
  DOCUMENT_INTENT_ENCRYPTION_KEY:keys.cipher};
 const study={DB:s.db,APP_ENV:'production',
  DOCUMENT_STUDY_EXECUTION_ENABLED:'true',
  DOCUMENT_STUDY_EXECUTION_SECRET:keys.studyExecutor,
  DOCUMENT_STUDY_PROOF_SECRET:keys.studyProof,
  DOCUMENT_STUDY_SOURCE_SECRET:keys.studySource};
 const identity={candidate_id:candidate,document_id:documentId,local_user_id:'local-member',
  homeflow_user_id:member,homeflow_household_id:hh,target_app:'it-study-platform',
  candidate_kind:'vocabulary',document_version:1,candidate_updated_at:now,
  payload_sha256:digest};
 const enc=await sealDocumentIntent(doc,identity,snapshot);
 d.sql.prepare('INSERT INTO document_member_sync_intents(candidate_id,document_id,'+
  'local_user_id,homeflow_user_id,homeflow_household_id,target_app,candidate_kind,'+
  'document_version,candidate_updated_at,payload_sha256,payload_cipher,payload_iv,'+
  "status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)")
  .run(candidate,documentId,'local-member',member,hh,'it-study-platform','vocabulary',
   1,now,digest,enc.payload_cipher,enc.payload_iv,now,now);
 const calls={source:0,sourceCheck:0,targetExecute:0,targetReceipt:0,proof:0};
 home.DOCUMENT_STUDY_EXECUTION_SERVICE={async fetch(req){
  calls.source++;
  const mode=new URL(req.url).pathname.split('/').at(-1);
  return documentStudySourceRoute(req,doc,mode);
 }};
 doc.STUDY_DOCUMENT_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1);
  calls[mode==='execute'?'targetExecute':'targetReceipt']++;
  return documentStudyExecution(req,study);
 }};
 doc.HOMEFLOW_BRIDGE_SERVICE={async fetch(req){
  if(new URL(req.url).pathname==='/api/internal/approvals/document-status')
   return documentApprovalStatusRoute(req,home);
  calls.proof++;
  return approvalVerificationRoute(req,home);
 }};
 study.DOCUMENT_STUDY_HOMEFLOW_SERVICE={async fetch(req){
  calls.proof++;
  return approvalVerificationRoute(req,home);
 }};
 study.DOCUMENT_STUDY_SOURCE_SERVICE={async fetch(req){
  calls.sourceCheck++;
  return documentStudySourceRoute(req,doc,'source-check');
 }};
 const wire={household_id:hh,requester_user_id:member,resource_id:candidate,
  payload_sha256:digest,target_app:'it-study-platform'};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 const sent=await documentApprovalSubmissionRoute(new Request(
  hurl+'/api/internal/approvals/document-submit',{method:'POST',
   headers:{'content-type':'application/json','x-approval-client':'jp-document-assistant',
    'x-approval-timestamp':stamp,'x-approval-signature':sign('jp-document-assistant',
     keys.submit,stamp,raw)},body:raw}),home);
 assert.equal(sent.status,201,await sent.clone().text());
 const id=(await sent.json()).approval_id;
 d.sql.prepare("UPDATE document_member_sync_intents SET status='submitted',approval_id=? WHERE candidate_id=?")
  .run(id,candidate);
 const ownerSession={household_id:hh,user_id:owner,role:'owner'};
 const memberDoc={user_id:'local-member',household_id:'local',role:'member',
  auth_source:'homeflow',homeflow_user_id:member,homeflow_household_id:hh};
 const review=async()=>approvalRoute(new Request(hurl+'/api/approvals/'+id+'/review',{
  method:'POST',headers:{'content-type':'application/json',origin:hurl},
  body:'{"decision":"approve"}'}),home,'/api/approvals/'+id+'/review',ownerSession);
 const execute=async()=>{
  const path='/api/approvals/'+id+'/execute';
  const r=await approvalExecutionRoute(new Request(hurl+path,{method:'POST',
   headers:{'content-type':'application/json',origin:hurl},body:'{}'}),
   home,path,ownerSession);
  return {status:r.status,data:await r.json()};
 };
 return {h,d,s,home,doc,study,id,calls,digest,review,execute,
  status:async()=>documentMemberApprovalStatus(doc,memberDoc,candidate),
  close(){h.sql.close();d.sql.close();s.sql.close()}};
}
test('three real app handlers: signed lease, encrypted snapshot, private study write and two exact receipts',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.status()).status,200);
  assert.equal((await f.review()).status,200);
  const pre=await f.status();
  assert.equal((await pre.json()).applied,false);
  const applied=await f.execute();
  assert.equal(applied.status,200,JSON.stringify(applied));
  assert.equal(applied.data.applied,true);
  assert.equal(applied.data.remote_id,candidate,'only opaque ID is allowed in HomeFlow');
  const target=f.s.sql.prepare('SELECT * FROM homeflow_saved_vocabulary').get();
  assert.equal(target.homeflow_user_id,member);
  assert.equal(target.term,'確認');
  assert.equal(f.s.sql.prepare('SELECT COUNT(*) n FROM homeflow_document_study_receipts').get().n,1);
  assert.equal(f.s.sql.prepare('SELECT approver_user_id FROM homeflow_document_study_approval_audit').get().approver_user_id,owner);
  const r=f.d.sql.prepare('SELECT * FROM document_study_execution_reservations').get();
  assert.equal(r.status,'applied');assert.equal(r.approver_user_id,owner);
  assert.equal(r.target_remote_id,'ja:確認');
  assert.equal(f.d.sql.prepare('SELECT actor_user_id FROM audit_events').get().actor_user_id,'local-owner');
  assert.equal(f.h.sql.prepare('SELECT status,remote_id FROM household_approval_requests').get().status,'applied');
  const final=await f.status();
  assert.equal(final.status,200,await final.clone().text());
  assert.equal((await final.json()).applied,true);
  assert.equal(JSON.stringify(f.h.sql.prepare('SELECT * FROM household_approval_requests').get()).includes('確認'),false);
  const again=await f.execute();
  assert.equal(again.status,200);assert.equal(again.data.replayed,true);
  assert.equal(f.calls.targetExecute,1);
  assert.equal(f.calls.sourceCheck,1);
  assert.equal(f.s.sql.prepare('SELECT COUNT(*) n FROM homeflow_saved_vocabulary').get().n,1);
 }finally{f.close()}
});
test('target committed but source never received reply: same request ID resumes by read-only target receipt',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.review()).status,200);
  const service=f.doc.STUDY_DOCUMENT_EXECUTION_SERVICE;
  f.doc.STUDY_DOCUMENT_EXECUTION_SERVICE={async fetch(req){
   const response=await service.fetch(req);
   if(new URL(req.url).pathname.endsWith('/execute')&&response.status===200)
    throw Error('injected network loss after Study D1 commit');
   return response;
  }};
  const lost=await f.execute();
  assert.notEqual(lost.status,200);
  assert.equal(f.h.sql.prepare('SELECT status FROM household_approval_requests').get().status,'failed_retryable');
  assert.equal(f.d.sql.prepare('SELECT status FROM document_study_execution_reservations').get().status,'executing');
  assert.equal(f.s.sql.prepare('SELECT COUNT(*) n FROM homeflow_saved_vocabulary').get().n,1);
  f.doc.STUDY_DOCUMENT_EXECUTION_SERVICE=service;
  const second=await f.execute();
  assert.equal(second.status,200,JSON.stringify(second));
  assert.equal(second.data.applied,true);
  assert.equal(f.calls.targetExecute,1,'second execution never writes Study data again');
  assert.equal(f.s.sql.prepare('SELECT COUNT(*) n FROM homeflow_document_study_receipts').get().n,1);
  assert.equal(f.d.sql.prepare('SELECT status FROM document_study_execution_reservations').get().status,'applied');
  assert.equal((await (await f.status()).json()).applied,true);
 }finally{f.close()}
});
test('pre-execution source revocation and feature-off fail closed with no Study write',async()=>{
 for(const kind of ['revoked','disabled','stale','study-disabled']){
  const f=await fixture();
  try{
   assert.equal((await f.review()).status,200);
   if(kind==='revoked')f.d.sql.prepare("UPDATE homeflow_identity_links SET state='revoked',revoked_at=? WHERE homeflow_user_id=?")
    .run(new Date().toISOString(),member);
   if(kind==='disabled')f.home.DOCUMENT_STUDY_EXECUTION_ENABLED='false';
   if(kind==='study-disabled')f.study.DOCUMENT_STUDY_EXECUTION_ENABLED='false';
   if(kind==='stale')f.d.sql.prepare('UPDATE documents SET version=version+1 WHERE id=?').run(documentId);
   const attempted=await f.execute();
   assert.notEqual(attempted.status,200,kind);
   assert.equal(f.s.sql.prepare('SELECT COUNT(*) n FROM homeflow_saved_vocabulary').get().n,0,kind);
   assert.equal(f.s.sql.prepare('SELECT COUNT(*) n FROM homeflow_document_study_receipts').get().n,0,kind);
  }finally{f.close()}
 }
});
test('document study migration safely replays; reservation and receipts cannot be deleted or changed',async()=>{
 const f=await fixture();
 try{
  f.d.sql.exec(readFileSync(new URL('../.contract-document/migrations/0026_document_study_execution_reservation.sql',import.meta.url),'utf8'));
  assert.equal((await f.review()).status,200);
  assert.equal((await f.execute()).status,200);
  assert.throws(()=>f.d.sql.prepare('DELETE FROM document_study_execution_reservations').run(),/NO_DELETE/);
  assert.throws(()=>f.d.sql.prepare("UPDATE document_study_execution_reservations SET target_remote_id='evil'").run(),/IMMUTABLE/);
  assert.throws(()=>f.s.sql.prepare('DELETE FROM homeflow_document_study_approval_audit').run(),/IMMUTABLE/);
 }finally{f.close()}
});
