import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {approvalRoute} from '../worker/approvals.js'

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
  f.sql.prepare('UPDATE household_approval_requests SET expires_at=1 WHERE request_id=?').run(id)
  const review=await f.call(sessions.owner,'/api/approvals/'+id+'/review','POST',{decision:'approve'})
  assert.equal(review.status,409)
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests').get().status,'pending')
  assert.throws(()=>f.sql.prepare("UPDATE household_approval_requests SET status='applied'").run(),/INVALID_APPROVAL_TRANSITION/)
 }finally{f.sql.close()}
})
