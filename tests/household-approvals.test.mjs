import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {approvalRoute} from '../worker/approvals.js'
import {approvalVerificationRoute} from '../worker/approval-verification.js'
import {approvalSubmissionRoute} from '../worker/approval-submission.js'
import {approvalExecutionRoute} from '../worker/approval-execution.js'
import {createHmac} from 'node:crypto'

const sessions={
 owner:{household_id:'primary',user_id:'owner',role:'owner'},
 member:{household_id:'primary',user_id:'member',role:'member'},
 stranger:{household_id:'second',user_id:'stranger',role:'owner'},
 spoof:{household_id:'primary',user_id:'member',role:'owner'}
}
const entry=(key='approval-test-key-000001',extra={})=>({
 source_app:'kakebo',target_app:'kakebo',operation:'finance.entry.create',
 resource_type:'finance_entry',payload_sha256:'a'.repeat(64),
 idempotency_key:key,...extra
})
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE households(id TEXT PRIMARY KEY);
  CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
  CREATE TABLE household_members(
    household_id TEXT NOT NULL REFERENCES households(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('owner','member')),
    PRIMARY KEY(household_id,user_id));
  INSERT INTO households VALUES('primary'),('second');
  INSERT INTO users VALUES('owner',NULL),('member',NULL),('stranger',NULL);
  INSERT INTO household_members VALUES
    ('primary','owner','owner'),('primary','member','member'),
    ('second','stranger','owner');
 `)
 sql.exec(readFileSync(new URL('../migrations/0054_household_approval_core.sql',import.meta.url),'utf8'))
 sql.exec(readFileSync(new URL('../migrations/0055_household_approval_execution_lease.sql',import.meta.url),'utf8'))
 const db={
  prepare(statement){
   return {bind(...params){return {
    first:async()=>sql.prepare(statement).get(...params)||null,
    all:async()=>({results:sql.prepare(statement).all(...params)}),
    run:async()=>({meta:{changes:Number(sql.prepare(statement).run(...params).changes)}}),
    _runSync:()=>sql.prepare(statement).run(...params)
   }}}
  },
  async batch(statements){
   sql.exec('BEGIN')
   try{
    const results=statements.map(x=>({meta:{changes:Number(x._runSync().changes)}}))
    sql.exec('COMMIT')
    return results
   }catch(error){sql.exec('ROLLBACK');throw error}
  }
 }
 const env={DB:db,APPROVALS_ENABLED:'true'}
 async function call(principal,path,method='GET',body,headers={}){
  const init={method,headers:{...headers}}
  if(body!==undefined){
   init.body=JSON.stringify(body)
   init.headers['content-type']='application/json'
  }
  if(method==='POST'&&!('origin' in init.headers))
   init.headers.origin='https://homeflow.example.test'
  const request=new Request('https://homeflow.example.test'+path,init)
  const response=await approvalRoute(request,env,new URL(request.url).pathname,principal)
  return {status:response.status,body:await response.json()}
 }
 return {sql,db,env,call}
}

test('disabled approval feature returns 503 with no DB write or leakage',async()=>{
 const f=fixture()
 try{
  f.env.APPROVALS_ENABLED='false'
  const r=await f.call(sessions.member,'/api/approvals','POST',entry())
  assert.equal(r.status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,0)
 }finally{f.sql.close()}
})
test('member creates pending approval, no applied side effect, immutable append-only history',async()=>{
 const f=fixture()
 try{
  const r=await f.call(sessions.member,'/api/approvals','POST',entry())
  assert.equal(r.status,201)
  const data=r.body.request
  assert.equal(data.status,'pending')
  assert.equal(data.applied,false)
  assert.equal(data.requester_user_id,'member')
  assert.equal(data.approver_user_id,null)
  assert.equal(data.expected_version,null)
  const row=f.sql.prepare('SELECT * FROM household_approval_requests').get()
  assert.equal(row.payload_sha256,'a'.repeat(64))
  assert.equal(row.household_id,'primary')
  assert.equal(row.target_app,'kakebo')
  assert.equal(row.status,'pending')
  assert.equal(f.sql.prepare('SELECT action,actor_user_id,actor_type FROM household_approval_events').get().action,'submitted')
  assert.throws(()=>f.sql.prepare("UPDATE household_approval_events SET action='approved'").run(),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare('DELETE FROM household_approval_events').run(),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare("UPDATE household_approval_requests SET requester_user_id='owner'").run(),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare("UPDATE household_approval_requests SET status='applied'").run(),/INVALID_APPROVAL_TRANSITION/)
 }finally{f.sql.close()}
})
test('only owner of same household can approve; approval is NOT applied until target confirms',async()=>{
 const f=fixture()
 try{
  const pending=await f.call(sessions.member,'/api/approvals','POST',entry())
  const id=pending.body.request.request_id
  assert.equal((await f.call(sessions.member,'/api/approvals/'+id+'/review','POST',{decision:'approve'})).status,403)
  assert.equal((await f.call(sessions.stranger,'/api/approvals/'+id+'/review','POST',{decision:'approve'})).status,404)
  assert.equal((await f.call(sessions.spoof,'/api/approvals/'+id+'/review','POST',{decision:'approve'})).status,403)
  const approved=await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})
  assert.equal(approved.status,200)
  assert.equal(approved.body.request.status,'approved')
  assert.equal(approved.body.request.applied,false)
  assert.equal(approved.body.request.approver_user_id,'owner')
  assert.ok(approved.body.request.reviewed_at>0)
  assert.equal(approved.body.request.executed_at,null)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,2)
  assert.equal((await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})).status,409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,2)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests WHERE status=?').get('applied').n,0)
 }finally{f.sql.close()}
})
test('member may cancel their own pending request; owner cannot approve later',async()=>{
 const f=fixture()
 try{
  const created=await f.call(sessions.member,'/api/approvals','POST',entry())
  const id=created.body.request.request_id
  const cancelled=await f.call(sessions.member,'/api/approvals/'+id+'/cancel','POST',{})
  assert.equal(cancelled.status,200)
  assert.equal(cancelled.body.request.status,'cancelled')
  assert.equal(cancelled.body.request.approver_user_id,null)
  assert.equal(cancelled.body.request.reviewed_at,null)
  assert.equal((await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})).status,409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,2)
 }finally{f.sql.close()}
})
test('reject is final, cannot approve rejected request and never touches target app',async()=>{
 const f=fixture()
 try{
  const created=await f.call(sessions.member,'/api/approvals','POST',entry())
  const id=created.body.request.request_id
  const rejected=await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'reject'})
  assert.equal(rejected.status,200)
  assert.equal(rejected.body.request.status,'rejected')
  assert.equal(rejected.body.request.applied,false)
  assert.equal((await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})).status,409)
  assert.equal((await f.call(sessions.member,'/api/approvals/'+id+'/cancel','POST',{})).status,409)
 }finally{f.sql.close()}
})
test('two simultaneous exact submissions converge on one request and one audit event',async()=>{
 const f=fixture()
 try{
  const both=await Promise.all([
   f.call(sessions.member,'/api/approvals','POST',entry('simultaneous-key-001')),
   f.call(sessions.member,'/api/approvals','POST',entry('simultaneous-key-001'))
  ])
  assert.deepEqual(both.map(x=>x.status).sort(),[200,201])
  assert.equal(both[0].body.request.request_id,both[1].body.request.request_id)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,1)
 }finally{f.sql.close()}
})
test('SQL approval requires a real same-household owner and cannot change reviewer after decision',async()=>{
 const f=fixture()
 try{
  const created=await f.call(sessions.member,'/api/approvals','POST',entry())
  const id=created.body.request.request_id
  assert.throws(()=>f.sql.prepare(
    "UPDATE household_approval_requests SET status='approved' WHERE request_id=?").run(id),/APPROVAL_OWNER_REQUIRED/)
  assert.throws(()=>f.sql.prepare(
    "UPDATE household_approval_requests SET status='approved',approver_user_id='member' WHERE request_id=?").run(id),/APPROVAL_OWNER_REQUIRED/)
  assert.throws(()=>f.sql.prepare(
    "UPDATE household_approval_requests SET status='approved',approver_user_id='stranger' WHERE request_id=?").run(id),/APPROVAL_OWNER_REQUIRED/)
  const approved=await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})
  assert.equal(approved.status,200)
  assert.throws(()=>f.sql.prepare(
    "UPDATE household_approval_requests SET approver_user_id='member' WHERE request_id=?").run(id),/APPROVAL_REVIEW_ACTOR_IMMUTABLE/)
  assert.throws(()=>f.sql.prepare(
    "UPDATE household_approval_requests SET status='applied' WHERE request_id=?").run(id),/INVALID_APPROVAL_TRANSITION/)
 }finally{f.sql.close()}
})

test('idempotent submission returns same request; reused key with altered payload is refused',async()=>{
 const f=fixture()
 try{
  const a=await f.call(sessions.member,'/api/approvals','POST',entry())
  const b=await f.call(sessions.member,'/api/approvals','POST',entry())
  assert.equal(a.status,201);assert.equal(b.status,200)
  assert.equal(b.body.replayed,true)
  assert.equal(b.body.request.request_id,a.body.request.request_id)
  assert.equal((await f.call(sessions.member,'/api/approvals','POST',
    entry(undefined,{payload_sha256:'b'.repeat(64)}))).status,409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,1)
 }finally{f.sql.close()}
})
test('all input operations are allowlisted and private payload/original text cannot be persisted',async()=>{
 const f=fixture()
 try{
  const cases=[
   entry('bad-001-x1234567890',{operation:'SQL DELETE FROM entries'}),
   entry('bad-002-x1234567890',{target_app:'https://untrusted.invalid'}),
   entry('bad-003-x1234567890',{source_app:'evil'}),
   entry('bad-004-x1234567890',{payload_sha256:'wrong'}),
   entry('bad-005-x1234567890',{amount:1520}),
   entry('bad-006-x1234567890',{original_document:'工资单原文'}),
   entry('bad-007-x1234567890',{expected_version:-1}),
   entry('bad-008-x1234567890',{operation:'finance.entry.delete'}),
   entry('bad-009-x1234567890',{operation:'document.sync.study',target_app:'kakebo'}),
  ]
  for(const body of cases)
   assert.equal((await f.call(sessions.member,'/api/approvals','POST',body)).status,400)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,0)
 }finally{f.sql.close()}
})
test('GET paginated five per page has no audit writes; members see only their own requests',async()=>{
 const f=fixture()
 try{
  for(let i=0;i<7;i++)
   assert.equal((await f.call(sessions.member,'/api/approvals','POST',
     entry('batch-approval-00000'+i))).status,201)
  const first=await f.call(sessions.owner,'/api/approvals?page=0')
  const second=await f.call(sessions.owner,'/api/approvals?page=1')
  assert.equal(first.status,200);assert.equal(second.status,200)
  assert.equal(first.body.items.length,5)
  assert.equal(first.body.has_more,true)
  assert.equal(second.body.items.length,2)
  const member=await f.call(sessions.member,'/api/approvals')
  assert.equal(member.body.items.length,5)
  assert.equal((await f.call(sessions.stranger,'/api/approvals')).body.items.length,0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,7)
  assert.equal((await f.call(sessions.member,'/api/approvals?status=approved')).body.items.length,0)
  const detail=await f.call(sessions.member,'/api/approvals/'+first.body.items[0].request_id)
  assert.equal(detail.status,200)
  assert.equal(detail.body.events.length,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,7)
 }finally{f.sql.close()}
})
test('origin and inactive membership protections fail closed',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.call(sessions.member,'/api/approvals','POST',entry(),
    {origin:'https://attacker.invalid'})).status,403)
  f.sql.prepare("UPDATE users SET disabled_at=1 WHERE id='member'").run()
  assert.equal((await f.call(sessions.member,'/api/approvals','POST',entry())).status,401)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,0)
 }finally{f.sql.close()}
})
test('expired pending cannot be reviewed; approval state machine rejects impossible status updates',async()=>{
 const f=fixture()
 try{
  const created=await f.call(sessions.member,'/api/approvals','POST',entry())
  const id=created.body.request.request_id
  f.sql.prepare('UPDATE household_approval_requests SET expires_at=created_at+1 WHERE request_id=?').run(id)
  // Do not race the same millisecond that created_at was recorded in CI.
  await new Promise(resolve=>setTimeout(resolve,15))
  const review=await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})
  assert.equal(review.status,409)
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests').get().status,'pending')
  assert.throws(()=>f.sql.prepare("UPDATE household_approval_requests SET status='applied'").run(),/INVALID_APPROVAL_TRANSITION/)
 }finally{f.sql.close()}
})


test('signed backchannel proof verifies exact approved digest and live household, never posts entries',async()=>{
 const f=fixture()
 try{
  const secret='c'.repeat(64)
  f.env.APP_ENV='production'
  f.env.APPROVAL_VERIFICATION_SECRET=secret
  f.env.APPROVAL_VERIFICATION_ENABLED='true'
  const draft=entry('source-bound-proof-0001',{resource_id:'pending-entry-abc123'})
  const pending=await f.call(sessions.member,'/api/approvals','POST',draft)
  assert.equal(pending.status,201)
  const approved=await f.call(sessions.owner,'/api/approvals/'+pending.body.request.request_id+'/review',
   'POST',{decision:'approve'})
  assert.equal(approved.status,200)
  const proof={request_id:pending.body.request.request_id,
   resource_id:draft.resource_id,household_id:'primary',requester_user_id:'member',
   payload_sha256:draft.payload_sha256,idempotency_key:draft.idempotency_key,
   expected_version:null}
  const tryProof=async(payload=proof,{client='kakeibo',timestamp=Date.now(),
   signature,headers={}}={})=>{
   const raw=JSON.stringify(payload),stamp=String(timestamp)
   const mac=signature??createHmac('sha256',Buffer.from(secret,'hex'))
    .update(client+'\n'+stamp+'\n'+raw).digest('hex')
   const response=await approvalVerificationRoute(new Request(
    'https://homeflow.example.test/api/internal/approvals/verify',{
     method:'POST',headers:{'content-type':'application/json',
      'x-approval-client':client,'x-approval-timestamp':stamp,
      'x-approval-signature':mac,...headers},body:raw
    }),f.env)
   return {status:response.status,body:await response.json()}
  }
  const eventsBefore=f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n
  const verified=await tryProof()
  assert.equal(verified.status,200,JSON.stringify(verified.body))
  assert.equal(verified.body.verified,true)
  assert.equal(verified.body.applied,false)
  assert.equal(verified.body.ledger_changed,false)
  for(const variant of [
   {...proof,payload_sha256:'b'.repeat(64)},
   {...proof,resource_id:'other-draft'},
   {...proof,requester_user_id:'owner'},
   {...proof,idempotency_key:'wrong-source-bound-001'},
   {...proof,household_id:'second'},
   {...proof,expected_version:0}
  ]){
   const mismatch=await tryProof(variant)
   assert.equal(mismatch.status,409,JSON.stringify(mismatch.body))
  }
  assert.equal((await tryProof(proof,{signature:'f'.repeat(64)})).status,403)
  assert.equal((await tryProof(proof,{timestamp:Date.now()-3600000})).status,403)
  assert.equal((await tryProof(proof,{headers:{origin:'https://homeflow.example.test'}})).status,403)
  assert.equal((await tryProof(proof,{headers:{cookie:'__Host-hf_session=secret'}})).status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,eventsBefore,
   'verification reads must not create noisy approval events')
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests').get().status,'approved')
  f.sql.prepare("UPDATE users SET disabled_at=1 WHERE id='member'").run()
  assert.equal((await tryProof()).status,409,'revoked requester cannot execute old approval')
  f.sql.prepare("UPDATE users SET disabled_at=NULL WHERE id='member'").run()
  f.sql.prepare("UPDATE household_members SET role='member' WHERE user_id='owner'").run()
  assert.equal((await tryProof()).status,409,'revoked owner review cannot authorize execution')
 }finally{f.sql.close()}
});
test('backchannel proof fails closed when unconfigured and pending is not executable',async()=>{
 const f=fixture()
 try{
  const secret='c'.repeat(64)
  f.env.APP_ENV='production'
  f.env.APPROVAL_VERIFICATION_SECRET=secret
  const proof={request_id:'11111111-1111-4111-8111-111111111111',
   resource_id:'pending-000001',household_id:'primary',requester_user_id:'member',
   payload_sha256:'a'.repeat(64),idempotency_key:'source-bound-proof-0001'}
  const stamp=String(Date.now()),raw=JSON.stringify(proof)
  const mac=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('kakeibo\n'+stamp+'\n'+raw).digest('hex')
  const request=()=>new Request('https://homeflow.example.test/api/internal/approvals/verify',{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo','x-approval-timestamp':stamp,
    'x-approval-signature':mac},body:raw})
  assert.equal((await approvalVerificationRoute(request(),f.env)).status,503)
  f.env.APPROVAL_VERIFICATION_ENABLED='true'
  assert.equal((await approvalVerificationRoute(request(),f.env)).status,409,
   'a correctly signed nonexistent request is still not approved')
  f.env.APP_ENV='preview'
  assert.equal((await approvalVerificationRoute(request(),f.env)).status,503)
  f.env.APP_ENV='production'
  f.env.APPROVAL_VERIFICATION_SECRET='too-short'
  assert.equal((await approvalVerificationRoute(request(),f.env)).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,0)
 }finally{f.sql.close()}
});


test('trusted Kakeibo member submission creates only one HomeFlow pending approval and survives replay',async()=>{
 const f=fixture()
 try{
  const secret='c'.repeat(64)
  f.env.APP_ENV='production'
  f.env.APPROVAL_VERIFICATION_SECRET=secret
  f.env.APPROVAL_SUBMISSION_ENABLED='true'
  const resourceId='f'.repeat(32)
  const body={household_id:'primary',requester_user_id:'member',
   resource_id:resourceId,payload_sha256:'a'.repeat(64)}
  async function submit(payload=body,{stamp=Date.now(),client='kakeibo',
   signature,headers={}}={}){
   const raw=JSON.stringify(payload),timestamp=String(stamp)
   const mac=signature||createHmac('sha256',Buffer.from(secret,'hex'))
    .update(client+'\n'+timestamp+'\n'+raw).digest('hex')
   const response=await approvalSubmissionRoute(new Request(
    'https://homeflow.example.test/api/internal/approvals/submit',{
     method:'POST',headers:{'content-type':'application/json',
      'x-approval-client':client,'x-approval-timestamp':timestamp,
      'x-approval-signature':mac,...headers},body:raw
    }),f.env)
   return {status:response.status,body:await response.json()}
  }
  let first=await submit()
  assert.equal(first.status,201,JSON.stringify(first.body))
  assert.equal(first.body.status,'pending')
  assert.equal(first.body.applied,false)
  assert.equal(first.body.ledger_changed,false)
  assert.equal(first.body.idempotency_key,'kakeibo:finance:'+resourceId)
  const replay=await submit()
  assert.equal(replay.status,200,JSON.stringify(replay.body))
  assert.equal(replay.body.approval_id,first.body.approval_id)
  assert.equal(replay.body.replayed,true)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,1)
  const row=f.sql.prepare('SELECT * FROM household_approval_requests').get()
  assert.equal(row.requester_user_id,'member')
  assert.equal(row.resource_id,resourceId)
  assert.equal(row.payload_sha256,'a'.repeat(64))
  assert.equal(row.status,'pending')
  assert.equal(row.approver_user_id,null)
  assert.equal((await submit({...body,payload_sha256:'b'.repeat(64)})).status,409,
   'same resource ID and different immutable content cannot create a second approval')
  assert.equal((await submit({...body,amount:1520})).status,400,
   'no financial amount may appear in HomeFlow approval journal')
  assert.equal((await submit(body,{signature:'f'.repeat(64)})).status,403)
  assert.equal((await submit(body,{stamp:Date.now()-3600000})).status,403)
  assert.equal((await submit(body,{headers:{origin:'https://homeflow.example.test'}})).status,403)
  assert.equal((await submit(body,{headers:{cookie:'__Host-hf_session=anything'}})).status,403)
  assert.equal((await submit({...body,requester_user_id:'stranger'})).status,401)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,1)
  f.sql.prepare("UPDATE users SET disabled_at=1 WHERE id='member'").run()
  assert.equal((await submit({...body,resource_id:'e'.repeat(32)})).status,401)
 }finally{f.sql.close()}
})
test('backend approval submission never starts without separate flag, secret and production',async()=>{
 const f=fixture()
 try{
  const response=await approvalSubmissionRoute(new Request(
   'https://homeflow.example.test/api/internal/approvals/submit',
   {method:'POST'}),f.env)
  assert.equal(response.status,503)
  f.env.APP_ENV='production'
  f.env.APPROVAL_SUBMISSION_ENABLED='true'
  assert.equal((await approvalSubmissionRoute(new Request(
   'https://homeflow.example.test/api/internal/approvals/submit',
   {method:'POST'}),f.env)).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,0)
 }finally{f.sql.close()}
})


test('owner approved CASH action obtains nonce lease and only actual Kakeibo receipt marks applied',async()=>{
 const f=fixture()
 try{
  const secret='c'.repeat(64)
  f.env.APP_ENV='production'
  f.env.APPROVAL_EXECUTION_ENABLED='true'
  f.env.APPROVAL_VERIFICATION_ENABLED='true'
  f.env.APPROVAL_VERIFICATION_SECRET=secret
  const created=await f.call(sessions.member,'/api/approvals','POST',
   entry('cash-posting-approval-0001',{resource_id:'a'.repeat(32)}))
  assert.equal(created.status,201)
  const id=created.body.request.request_id
  assert.equal((await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',
   {decision:'approve'})).status,200)
  let targetCalls=0
  f.env.KAKEIBO_EXECUTION_SERVICE={async fetch(request){
   targetCalls++
   assert.equal(new URL(request.url).pathname,'/api/internal/approved-actions/execute')
   assert.equal(request.headers.get('cookie'),null)
   assert.equal(request.headers.get('origin'),null)
   assert.equal(request.redirect,'manual')
   const raw=await request.text()
   const ts=request.headers.get('x-approval-timestamp')
   const mac=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('homeflow\n'+ts+'\n'+raw).digest('hex')
   assert.equal(request.headers.get('x-approval-signature'),mac)
   const intent=JSON.parse(raw)
   assert.equal(intent.request_id,id)
   assert.equal(intent.resource_id,'a'.repeat(32))
   assert.match(intent.execution_nonce,/^[a-f0-9]{64}$/)
   const state=f.sql.prepare('SELECT status,execution_nonce_hash,execution_lease_until FROM household_approval_requests WHERE request_id=?').get(id)
   assert.equal(state.status,'executing')
   assert.ok(state.execution_lease_until>Date.now())
   const proof={request_id:id,resource_id:intent.resource_id,
    household_id:'primary',requester_user_id:'member',
    payload_sha256:'a'.repeat(64),
    idempotency_key:'cash-posting-approval-0001',
    expected_version:null,purpose:'execute',execution_nonce:intent.execution_nonce}
   async function verify(fields){
    const b=JSON.stringify(fields),t=String(Date.now())
    const sig=createHmac('sha256',Buffer.from(secret,'hex'))
     .update('kakeibo\n'+t+'\n'+b).digest('hex')
    return approvalVerificationRoute(new Request(
     'https://homeflow.example.test/api/internal/approvals/verify',{
      method:'POST',headers:{'content-type':'application/json',
       'x-approval-client':'kakeibo','x-approval-timestamp':t,
       'x-approval-signature':sig},body:b
     }),f.env)
   }
   const verified=await verify(proof)
   assert.equal(verified.status,200,await verified.clone().text())
   const info=await verified.json()
   assert.equal(info.execution_authorized,true)
   assert.equal(info.approver_user_id,'owner')
   assert.equal((await verify({...proof,execution_nonce:'f'.repeat(64)})).status,409)
   assert.equal((await verify({...proof,purpose:undefined,execution_nonce:undefined})).status,409)
   return Response.json({ok:true,applied:true,approval_id:id,
    proposal_id:'a'.repeat(32),household_id:'primary',
    requester_user_id:'member',payload_sha256:'a'.repeat(64),
    entry_id:123,already_applied:false,applied_at:Date.now()})
  }}
  const execute=async(principal=sessions.owner)=>{
   const res=await approvalExecutionRoute(
    new Request('https://homeflow.example.test/api/approvals/'+id+'/execute',{
     method:'POST',headers:{origin:'https://homeflow.example.test',
      'content-type':'application/json'},body:'{}'
    }),f.env,'/api/approvals/'+id+'/execute',principal)
   return {status:res.status,body:await res.json()}
  }
  assert.equal((await execute(sessions.member)).status,403)
  const confirmed=await execute()
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body))
  assert.equal(confirmed.body.status,'applied')
  assert.equal(confirmed.body.remote_id,'123')
  assert.equal(targetCalls,1)
  const row=f.sql.prepare('SELECT * FROM household_approval_requests WHERE request_id=?').get(id)
  assert.equal(row.status,'applied')
  assert.equal(row.remote_id,'123')
  assert.equal(row.execution_nonce_hash,null)
  assert.equal(row.execution_lease_until,null)
  assert.equal(row.execution_attempts,1)
  assert.equal((await execute()).body.status,'already_applied')
  assert.equal(targetCalls,1,'duplicate owner approval must not send target twice')
  const audit=f.sql.prepare('SELECT action FROM household_approval_events WHERE request_id=? ORDER BY created_at,event_id').all(id)
  assert.equal(audit.length,4)
  assert.ok(['submitted','approved','executing','applied'].every(kind=>audit.some(x=>x.action===kind)))
 }finally{f.sql.close()}
})
test('lost target response is retryable, reuses same approval ID and settles once',async()=>{
 const f=fixture()
 try{
  f.env.APP_ENV='production'
  f.env.APPROVAL_VERIFICATION_SECRET='c'.repeat(64)
  f.env.APPROVAL_EXECUTION_ENABLED='true'
  f.env.APPROVAL_VERIFICATION_ENABLED='true'
  const requested=await f.call(sessions.member,'/api/approvals','POST',
   entry('lost-receipt-approval-0001',{resource_id:'b'.repeat(32)}))
  const id=requested.body.request.request_id
  await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})
  let remoteRecord=null,attempts=0
  f.env.KAKEIBO_EXECUTION_SERVICE={async fetch(request){
   attempts++
   const body=JSON.parse(await request.text())
   if(!remoteRecord)remoteRecord=body
   else assert.equal(remoteRecord.request_id,body.request_id)
   if(attempts===1)throw Error('worker delivered and target committed; response lost')
   return Response.json({ok:true,applied:true,approval_id:id,
    proposal_id:'b'.repeat(32),household_id:'primary',
    requester_user_id:'member',payload_sha256:'a'.repeat(64),
    entry_id:995,already_applied:true,applied_at:Date.now()})
  }}
  const execute=()=>approvalExecutionRoute(new Request(
    'https://homeflow.example.test/api/approvals/'+id+'/execute',{
     method:'POST',headers:{origin:'https://homeflow.example.test',
      'content-type':'application/json'},body:'{}'
    }),f.env,'/api/approvals/'+id+'/execute',sessions.owner)
  assert.equal((await execute()).status,503)
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(id).status,
   'failed_retryable')
  const retry=await execute()
  assert.equal(retry.status,200,await retry.clone().text())
  assert.equal((await retry.json()).status,'applied')
  assert.equal(attempts,2)
  const row=f.sql.prepare('SELECT status,execution_attempts,remote_id FROM household_approval_requests WHERE request_id=?').get(id)
  assert.equal(row.status,'applied')
  assert.equal(row.remote_id,'995')
  assert.equal(row.execution_attempts,2)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_events WHERE request_id=? AND action='applied'").get(id).n,1)
 }finally{f.sql.close()}
})

test('expired uncertain cash execution only reads the original target receipt and can reconcile it',async()=>{
 const f=fixture()
 try{
  const secret='c'.repeat(64)
  Object.assign(f.env,{APP_ENV:'production',APPROVAL_VERIFICATION_SECRET:secret,
   APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true'})
  const created=await f.call(sessions.member,'/api/approvals','POST',
   entry('expired-receipt-recovery-0001',{resource_id:'d'.repeat(32)}))
  const id=created.body.request.request_id
  await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})
  let attempts=0,postedAt=0,found=false
  f.env.KAKEIBO_EXECUTION_SERVICE={async fetch(request){
   const path=new URL(request.url).pathname,raw=await request.text()
   const timestamp=request.headers.get('x-approval-timestamp')
   const data=JSON.parse(raw)
   assert.equal(data.request_id,id)
   if(!attempts++){
    assert.equal(path,'/api/internal/approved-actions/execute')
    postedAt=Date.now()
    throw Error('committed but response lost')
   }
   assert.equal(path,'/api/internal/approved-actions/receipt')
   assert.equal('execution_nonce' in data,false)
   assert.equal(request.headers.get('x-approval-signature'),createHmac('sha256',Buffer.from(secret,'hex'))
    .update('homeflow:receipt\n'+timestamp+'\n'+raw).digest('hex'))
   if(!found)return Response.json({ok:false,applied:false},{status:404})
   return Response.json({ok:true,applied:true,approval_id:id,proposal_id:'d'.repeat(32),
    household_id:'primary',requester_user_id:'member',payload_sha256:'a'.repeat(64),
    entry_id:876,already_applied:true,applied_at:postedAt})
  }}
  const execute=()=>approvalExecutionRoute(new Request('https://homeflow.example.test/api/approvals/'+id+'/execute',{
   method:'POST',headers:{origin:'https://homeflow.example.test','content-type':'application/json'},body:'{}'
  }),f.env,'/api/approvals/'+id+'/execute',sessions.owner)
  assert.equal((await execute()).status,503)
  f.sql.prepare('UPDATE household_approval_requests SET expires_at=created_at+1 WHERE request_id=?').run(id)
  await new Promise(resolve=>setTimeout(resolve,5))
  const uncertain=await execute()
  assert.equal(uncertain.status,503)
  assert.equal((await uncertain.json()).code,'expired_receipt_unknown')
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(id).status,'failed_retryable')
  found=true
  const settled=await execute()
  assert.equal(settled.status,200,await settled.clone().text())
  assert.equal((await settled.json()).remote_id,'876')
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(id).status,'applied')
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_events WHERE request_id=? AND action='applied'").get(id).n,1)
  const neverStarted=await f.call(sessions.member,'/api/approvals','POST',
   entry('expired-never-executed-0001',{resource_id:'e'.repeat(32)}))
  const freshId=neverStarted.body.request.request_id
  await f.call(sessions.owner,'/api/approvals/'+freshId+'/review','POST',{decision:'approve'})
  f.sql.prepare('UPDATE household_approval_requests SET expires_at=created_at+1 WHERE request_id=?').run(freshId)
  await new Promise(resolve=>setTimeout(resolve,5))
  const stale=await approvalExecutionRoute(new Request('https://homeflow.example.test/api/approvals/'+freshId+'/execute',{
   method:'POST',headers:{origin:'https://homeflow.example.test','content-type':'application/json'},body:'{}'
  }),f.env,'/api/approvals/'+freshId+'/execute',sessions.owner)
  assert.equal(stale.status,409)
  assert.equal(attempts,3,'expired unexecuted approval does not contact the target')
 }finally{f.sql.close()}
})



test('target 409 is not a terminal conflict: unchanged approval can reconcile a late applied receipt',async()=>{
 const f=fixture()
 try{
  f.env.APP_ENV='production'
  f.env.APPROVAL_VERIFICATION_SECRET='c'.repeat(64)
  f.env.APPROVAL_EXECUTION_ENABLED='true'
  f.env.APPROVAL_VERIFICATION_ENABLED='true'
  const created=await f.call(sessions.member,'/api/approvals','POST',
   entry('target-409-reconciliation-0001',{resource_id:'c'.repeat(32)}))
  assert.equal(created.status,201)
  const id=created.body.request.request_id
  assert.equal((await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',
   {decision:'approve'})).status,200)
  const sent=[],targetRecord={entry_id:736,applied_at:Date.now()}
  f.env.KAKEIBO_EXECUTION_SERVICE={async fetch(request){
   assert.equal(request.headers.get('cookie'),null)
   assert.equal(request.headers.get('origin'),null)
   const body=JSON.parse(await request.text())
   sent.push(body)
   if(sent.length===1){
    // Kakeibo can report this while HomeFlow's proof or target journal is
    // temporarily inaccessible; a 409 is not an authenticated no-post proof.
    return Response.json({ok:false,code:'APPROVAL_NOT_EXECUTING',applied:false},
     {status:409})
   }
   return Response.json({ok:true,applied:true,approval_id:id,
    proposal_id:'c'.repeat(32),household_id:'primary',
    requester_user_id:'member',payload_sha256:'a'.repeat(64),
    entry_id:targetRecord.entry_id,already_applied:true,
    applied_at:targetRecord.applied_at})
  }}
  const execute=()=>approvalExecutionRoute(new Request(
   'https://homeflow.example.test/api/approvals/'+id+'/execute',{
    method:'POST',headers:{origin:'https://homeflow.example.test',
     'content-type':'application/json'},body:'{}'
   }),f.env,'/api/approvals/'+id+'/execute',sessions.owner)
  const first=await execute()
  assert.equal(first.status,503,await first.clone().text())
  assert.equal((await first.json()).code,'target_conflict_unconfirmed_safe_to_retry')
  const pending=f.sql.prepare('SELECT status,last_error_code,execution_nonce_hash,execution_lease_until,remote_id FROM household_approval_requests WHERE request_id=?').get(id)
  assert.equal(pending.status,'failed_retryable')
  assert.equal(pending.last_error_code,'target_conflict_unconfirmed')
  assert.equal(pending.execution_nonce_hash,null)
  assert.equal(pending.execution_lease_until,null)
  assert.equal(pending.remote_id,null)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_events WHERE request_id=? AND action='conflict'").get(id).n,0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_events WHERE request_id=? AND action='applied'").get(id).n,0)
  const second=await execute()
  assert.equal(second.status,200,await second.clone().text())
  const receipt=await second.json()
  assert.equal(receipt.applied,true)
  assert.equal(receipt.replayed,true)
  assert.equal(receipt.remote_id,'736')
  assert.equal(sent.length,2)
  assert.equal(sent[0].request_id,id)
  assert.equal(sent[1].request_id,id,'target always reconciles the exact immutable approval')
  assert.notEqual(sent[0].execution_nonce,sent[1].execution_nonce,
   'every lease must issue a fresh nonce, but not a new approval')
  const applied=f.sql.prepare('SELECT status,execution_attempts,remote_id FROM household_approval_requests WHERE request_id=?').get(id)
  assert.equal(applied.status,'applied')
  assert.equal(applied.execution_attempts,2)
  assert.equal(applied.remote_id,'736')
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_events WHERE request_id=? AND action='applied'").get(id).n,1)
 }finally{f.sql.close()}
})


test('approval center feature probe is read-only and never exposes disabled queue',async()=>{
 const f=fixture()
 try{
  const request=new Request('https://homeflow.example.test/api/approvals/status')
  const beforeRequests=f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n
  const beforeEvents=f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n
  f.env.APPROVALS_ENABLED='false'
  const disabled=await approvalRoute(request,f.env,'/api/approvals/status',sessions.owner)
  assert.equal(disabled.status,200)
  assert.deepEqual(await disabled.json(),{enabled:false,execution_enabled:false})
  assert.equal((await approvalRoute(new Request(
   'https://homeflow.example.test/api/approvals'),
   f.env,'/api/approvals',sessions.owner)).status,503)
  f.env.APPROVALS_ENABLED='true'
  f.env.APPROVAL_EXECUTION_ENABLED='false'
  const active=await approvalRoute(request,f.env,'/api/approvals/status',sessions.member)
  assert.deepEqual(await active.json(),{enabled:true,execution_enabled:false})
  f.env.APPROVAL_EXECUTION_ENABLED='true'
  const executing=await approvalRoute(request,f.env,'/api/approvals/status',sessions.owner)
  assert.deepEqual(await executing.json(),{enabled:true,execution_enabled:true})
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,beforeRequests)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_events').get().n,beforeEvents)
 }finally{f.sql.close()}
})
