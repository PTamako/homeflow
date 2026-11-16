import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {applyDocumentTask,documentTaskReceipt} from '../worker/document-task-apply.js';
import {sha256} from '../worker/security.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='owner',member='member',hh='household',candidate='b'.repeat(32);
const digest='c'.repeat(64),nonce='d'.repeat(64);
const approval='55555555-5555-4555-8555-555555555555';
const task=()=>({operation:'task',title:'配送確認',dueOn:'2026-11-19',
 visibility:'private',assignee:null,bonusPoints:0,remindEnabled:true});
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 const code=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8');
 const files=code.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1]
  .match(/"[^"]+\.sql"/g).map(s=>s.slice(1,-1));
 assert.ok(files.includes('0056_document_task_apply.sql'));
 for(const name of files)sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sql.prepare('INSERT INTO households(id,display_name) VALUES(?,?)').run(hh,'Home');
 for(const [id,role] of [[owner,'owner'],[member,'member']]){
  sql.prepare('INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)')
   .run(id,id,'s','v');
  sql.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
   .run(hh,id,role);
 }
 const db={prepare(statement){return{bind(...args){return{
  first:async()=>sql.prepare(statement).get(...args)||null,
  sync:()=>({meta:{changes:sql.prepare(statement).run(...args).changes}})
 }}}},async batch(stmts){
  sql.exec('BEGIN IMMEDIATE');
  try{const items=stmts.map(s=>s.sync());sql.exec('COMMIT');return items}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 const env={DB:db,APP_ENV:'production',APPROVALS_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  DOCUMENT_TASK_EXECUTION_ENABLED:'true'};
 async function approve(){
  const now=Date.now();
  sql.prepare("INSERT INTO household_approval_requests "+
   "(request_id,household_id,requester_user_id,source_app,target_app,operation,"+
   "resource_type,resource_id,payload_sha256,idempotency_key,status,"+
   "created_at,updated_at,expires_at) VALUES(?,?,?,"+
   "'jp-document-assistant','homeflow','document.sync.homeflow',"+
   "'document_sync_candidate',?,? ,?,'pending',?,?,?)")
   .run(approval,hh,member,candidate,digest,'jpda:sync:'+candidate,now-100000,now-100000,now+600000);
  sql.prepare("UPDATE household_approval_requests SET status='approved',"+
   "approver_user_id=?,reviewed_at=?,updated_at=? WHERE request_id=?")
   .run(owner,now-1000,now-1000,approval);
  sql.prepare("UPDATE household_approval_requests SET status='executing',"+
   "execution_nonce_hash=?,execution_lease_until=?,updated_at=? WHERE request_id=?")
   .run(await sha256(nonce),now+120000,now,approval);
 }
 const payload=async t=>({request_id:approval,resource_id:candidate,household_id:hh,
  requester_user_id:member,payload_sha256:digest,
  operation_sha256:await sha256(JSON.stringify(t)),execution_nonce:nonce});
 return {sql,env,payload,approve,close:()=>sql.close()};
}
test('target journal atomically creates task, marks applied, audits approver and replays original id',async()=>{
 const f=fixture();
 try{
  await f.approve();
  const b=await f.payload(task());
  const first=await applyDocumentTask(f.env,b,task());
  assert.equal(first.applied,true,JSON.stringify(first));
  const t=f.sql.prepare('SELECT * FROM tasks WHERE id=?').get(first.task_id);
  assert.equal(t.creator_user_id,member);
  assert.equal(t.title,'配送確認');
  assert.equal(t.visibility,'private');
  assert.equal(t.completed_at,null);
  assert.equal(t.remind_enabled,1);
  const a=f.sql.prepare('SELECT status,remote_id,execution_nonce_hash FROM household_approval_requests').get();
  assert.equal(a.status,'applied');
  assert.equal(a.remote_id,first.task_id);
  assert.equal(a.execution_nonce_hash,null);
  const audit=f.sql.prepare("SELECT * FROM household_approval_events WHERE action='applied'").get();
  assert.equal(audit.actor_user_id,owner);
  const again=await applyDocumentTask(f.env,b,task());
  assert.equal(again.applied,true);
  assert.equal(again.replayed,true);
  assert.equal(again.task_id,first.task_id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_task_applied_actions').get().n,1);
  assert.throws(()=>f.sql.prepare('DELETE FROM document_task_applied_actions').run(),/IMMUTABLE/);
  const receipt=await documentTaskReceipt(f.env,Object.fromEntries(
   Object.entries(b).filter(([k])=>['request_id','resource_id','household_id','requester_user_id','payload_sha256'].includes(k))));
  assert.equal(receipt.task_id,first.task_id);
 }finally{f.close()}
});
test('nonce, digest, member, household, version and expiry checks deny task writes',async()=>{
 for(const caseName of ['nonce','digest','disabled','household','candidate','expired']){
  const f=fixture();
  try{
   await f.approve();const b=await f.payload(task());
   if(caseName==='nonce')b.execution_nonce='e'.repeat(64);
   if(caseName==='digest')b.operation_sha256='f'.repeat(64);
   if(caseName==='disabled')f.sql.prepare('UPDATE users SET disabled_at=? WHERE id=?')
    .run(new Date().toISOString(),member);
   if(caseName==='household')b.household_id='foreign';
   if(caseName==='candidate')b.resource_id='f'.repeat(32);
   if(caseName==='expired')f.sql.prepare('UPDATE household_approval_requests SET expires_at=?')
    .run(Date.now()-1);
   const result=await applyDocumentTask(f.env,b,task());
   assert.equal(result.applied,false,caseName+':'+JSON.stringify(result));
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  }finally{f.close()}
 }
});
test('reuse HomeFlow task business validation, including no unauthorized bonus reservations',async()=>{
 const f=fixture();
 try{
  await f.approve();
  for(const update of [{assignee:owner},{visibility:'household',assignee:owner,bonusPoints:2},
   {operation:'not_task'},{title:''},{bonusPoints:-1}]){
   const t={...task(),...update};
   const result=await applyDocumentTask(f.env,await f.payload(t),t);
   assert.equal(result.applied,false,JSON.stringify(result));
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
 }finally{f.close()}
});
test('injected failure after task insert rolls back task and approval; retry succeeds',async()=>{
 const f=fixture();
 try{
  await f.approve();const b=await f.payload(task()),original=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
   f.sql.exec('BEGIN IMMEDIATE');
   try{
    assert.equal(statements[0].sync().meta.changes,1);
    throw Error('injected crash before journal');
   }finally{f.sql.exec('ROLLBACK')}
  };
  const first=await applyDocumentTask(f.env,b,task());
  assert.equal(first.applied,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_task_applied_actions').get().n,0);
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests').get().status,'executing');
  f.env.DB.batch=original;
  const retry=await applyDocumentTask(f.env,b,task());
  assert.equal(retry.applied,true,JSON.stringify(retry));
 }finally{f.close()}
});
test('new flag defaults fail closed and additive migration is safely replayable',async()=>{
 const f=fixture();
 try{
  await f.approve();const b=await f.payload(task());
  f.env.DOCUMENT_TASK_EXECUTION_ENABLED='false';
  assert.equal((await applyDocumentTask(f.env,b,task())).applied,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  f.env.DOCUMENT_TASK_EXECUTION_ENABLED='true';
  f.sql.exec(readFileSync(new URL('../migrations/0056_document_task_apply.sql',import.meta.url),'utf8'));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_document_task_applied_household'").get().n,1);
 }finally{f.close()}
});
