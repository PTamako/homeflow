import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHmac} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {documentApprovalSubmissionRoute} from '../worker/document-approval-submission.js'

const secret='d'.repeat(64),app='https://homeflow.example.test'
const candidate='a'.repeat(32),digest='b'.repeat(64)
const intent=(target_app='kakebo')=>({
 household_id:'h1',requester_user_id:'member',
 resource_id:candidate,payload_sha256:digest,target_app
})
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE households(id TEXT PRIMARY KEY);
 CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  PRIMARY KEY(household_id,user_id));
 INSERT INTO households VALUES('h1'),('h2');
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('outside',NULL);
 INSERT INTO household_members VALUES
  ('h1','owner','owner'),('h1','member','member'),('h2','outside','owner');
 `)
 for(const name of ['0054_household_approval_core.sql','0055_household_approval_execution_lease.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 const db={
  prepare(query){return{bind(...args){return{
   first:async()=>sql.prepare(query).get(...args)||null,
   all:async()=>({results:sql.prepare(query).all(...args)}),
   run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}}),
   _runSync:()=>sql.prepare(query).run(...args)
  }}}},
  async batch(stmts){
   sql.exec('BEGIN')
   try{const results=stmts.map(x=>({meta:{changes:x._runSync().changes}}))
    sql.exec('COMMIT');return results}
   catch(e){sql.exec('ROLLBACK');throw e}
  }
 }
 const env={DB:db,APP_ENV:'production',APPROVALS_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_ENABLED:'true',
  DOCUMENT_APPROVAL_SUBMISSION_SECRET:secret}
 async function call(body=intent(),options={}){
  const raw=options.raw??JSON.stringify(body)
  const stamp=String(options.stamp??Date.now())
  const signature=options.signature??createHmac('sha256',Buffer.from(
   options.signWith||secret,'hex')).update('jp-document-assistant\n'+stamp+'\n'+raw).digest('hex')
  const headers={
   'content-type':'application/json','x-approval-client':options.client||'jp-document-assistant',
   'x-approval-timestamp':stamp,'x-approval-signature':signature,
   ...options.headers
  }
  const req=new Request(app+'/api/internal/approvals/document-submit',{
   method:options.method||'POST',headers,
   ...(options.method==='GET'?{}:{body:raw})
  })
  const response=await documentApprovalSubmissionRoute(req,env)
  return {status:response.status,body:await response.json()}
 }
 return {sql,env,call}
}
test('signed document finance, HomeFlow task and study intent each create exactly one review, never apply',async()=>{
 const scopes=[
  ['kakebo','document.sync.finance'],
  ['homeflow','document.sync.homeflow'],
  ['it-study-platform','document.sync.study']
 ]
 for(const [target,operation] of scopes){
  const f=fixture()
  try{
   const first=await f.call(intent(target))
   assert.equal(first.status,201,JSON.stringify(first.body))
   assert.equal(first.body.status,'pending')
   assert.equal(first.body.applied,false)
   assert.equal(first.body.target_changed,false)
   assert.equal(first.body.target_app,target)
   const row=f.sql.prepare('SELECT * FROM household_approval_requests').get()
   assert.equal(row.source_app,'jp-document-assistant')
   assert.equal(row.target_app,target)
   assert.equal(row.operation,operation)
   assert.equal(row.resource_type,'document_sync_candidate')
   assert.equal(row.idempotency_key,'jpda:sync:'+candidate)
   assert.equal(row.payload_sha256,digest)
   assert.equal(row.requester_user_id,'member')
   assert.equal(row.household_id,'h1')
   assert.equal(row.status,'pending')
   assert.equal(row.remote_id,null)
   const replay=await f.call(intent(target))
   assert.equal(replay.status,200)
   assert.equal(replay.body.approval_id,first.body.approval_id)
   assert.equal(replay.body.replayed,true)
   assert.equal(f.sql.prepare('SELECT count(*) n FROM household_approval_requests').get().n,1)
   assert.equal(f.sql.prepare('SELECT count(*) n FROM household_approval_events').get().n,1)
   assert.equal(f.sql.prepare('SELECT actor_type,actor_user_id,action FROM household_approval_events').get().action,'submitted')
   assert.equal((await f.call({...intent(target),payload_sha256:'c'.repeat(64)})).status,409)
   assert.equal((await f.call({...intent(target),target_app:target==='kakebo'?'homeflow':'kakebo'})).status,409)
   assert.equal(f.sql.prepare('SELECT count(*) n FROM household_approval_requests').get().n,1)
  }finally{f.sql.close()}
 }
})
test('document signature source is backend-only, independent of Kakeibo approval secret',async()=>{
 const f=fixture()
 try{
  for(const options of [
   {headers:{Cookie:'session=spoof'}},
   {headers:{Origin:app}},
   {headers:{Authorization:'Bearer spoof'}},
   {client:'kakeibo'},
   {stamp:Date.now()-900000},
   {signature:'0'.repeat(64)},
   {signWith:'c'.repeat(64)},
  ]){
   const result=await f.call(intent(),options)
   assert.equal(result.status,403,JSON.stringify(options))
  }
  f.env.DOCUMENT_APPROVAL_SUBMISSION_ENABLED='false'
  assert.equal((await f.call()).status,503)
  f.env.DOCUMENT_APPROVAL_SUBMISSION_ENABLED='true'
  f.env.DOCUMENT_APPROVAL_SUBMISSION_SECRET='short'
  assert.equal((await f.call()).status,503)
  f.env.DOCUMENT_APPROVAL_SUBMISSION_SECRET=secret
  f.env.APPROVALS_ENABLED='false'
  assert.equal((await f.call()).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,0)
 }finally{f.sql.close()}
})
test('a signed document approval cannot forge owner, missing member, other household or raw PII',async()=>{
 const f=fixture()
 try{
  const invalid=[
   {...intent(),requester_user_id:'owner'},
   {...intent(),requester_user_id:'outside'},
   {...intent(),household_id:'h2'},
   {...intent(),household_id:'h2',requester_user_id:'member'},
   {...intent(),target_app:'evil-worker'},
   {...intent(),resource_id:'../private-doc'},
   {...intent(),payload_sha256:'-'.repeat(64)},
   {...intent(),raw_document:'secret'},
   {...intent(),amount:1234},
   {...intent(),target_url:'https://evil.example'},
  ]
  for(const request of invalid){
   const result=await f.call(request)
   assert.ok([400,401,403].includes(result.status),JSON.stringify({request,result}))
  }
  f.sql.prepare("UPDATE users SET disabled_at=1 WHERE id='member'").run()
  assert.equal((await f.call()).status,401)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,0)
 }finally{f.sql.close()}
})
