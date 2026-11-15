import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto} from 'node:crypto'
import {approvalRoute} from '../worker/approvals.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner={user_id:'owner',household_id:'primary',role:'owner'}
const member={user_id:'member',household_id:'primary',role:'member'}
const stranger={user_id:'outsider',household_id:'second',role:'owner'}
const count=(s,table)=>s.prepare('SELECT COUNT(*) n FROM '+table).get().n
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE households(id TEXT PRIMARY KEY);
 CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(household_id,user_id));
 INSERT INTO households VALUES('primary'),('second');
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('outsider',NULL);
 INSERT INTO household_members VALUES('primary','owner','owner'),
 ('primary','member','member'),('second','outsider','owner');`)
 for(const name of ['0054_household_approval_core.sql','0055_household_approval_execution_lease.sql',
  '0057_household_batch_reviews.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 const db={prepare(q){return {bind(...a){return {
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...a).changes}})
 }}}},async batch(commands){sql.exec('BEGIN IMMEDIATE');try{
  const out=commands.map(c=>c.sync());sql.exec('COMMIT');return out
 }catch(e){sql.exec('ROLLBACK');throw e}}}
 const env={DB:db,APP_ENV:'production',APPROVALS_ENABLED:'true',APPROVAL_BATCH_REVIEW_ENABLED:'true'}
 const call=async(user,path,body,method='POST')=>{
  const req=new Request('https://homeflow.example.test'+path,{method,
   headers:method==='POST'?{origin:'https://homeflow.example.test','content-type':'application/json'}:{},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})})
  const response=await approvalRoute(req,env,path,user)
  return {status:response.status,data:await response.json()}
 }
 const item=async(i)=>{const b={
  source_app:'kakebo',target_app:'kakebo',operation:'finance.entry.create',
  resource_type:'finance_entry',idempotency_key:'batch-key-item-0000'+i,
  payload_sha256:'a'.repeat(64),expected_version:1}
  const x=await call(member,'/api/approvals',b)
  assert.equal(x.status,201,JSON.stringify(x))
  return {request_id:x.data.request.request_id,expected_version:x.data.request.version}
 }
 const payload=(items,decision='approve',batch_id=crypto.randomUUID())=>({
  batch_id,decision,expected_user_id:'owner',items})
 return {sql,db,env,call,item,payload,close(){sql.close()}}
}
test('atomic owner batch approves 3 requests and journals 3 actors, no target execution',async()=>{
 const f=fixture();try{
  const items=await Promise.all([f.item(1),f.item(2),f.item(3)])
  const batch=f.payload(items)
  const applied=await f.call(owner,'/api/approvals/batch-review',batch)
  assert.equal(applied.status,200,JSON.stringify(applied))
  assert.equal(applied.data.applied,false)
  assert.equal(applied.data.count,3)
  assert.equal(count(f.sql,'household_approval_review_batches'),1)
  assert.equal(count(f.sql,'household_approval_events'),6)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_requests WHERE status='approved'").get().n,3)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_requests WHERE status='applied'").get().n,0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM household_approval_requests WHERE approver_user_id='owner'").get().n,3)
  const replay=await f.call(owner,'/api/approvals/batch-review',batch)
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true)
  assert.equal(count(f.sql,'household_approval_events'),6)
  const detail=await f.call(owner,'/api/approvals/batch-review/'+batch.batch_id,undefined,'GET')
  assert.equal(detail.status,200);assert.equal(detail.data.count,3)
  const forged={...batch,decision:'reject'}
  assert.equal((await f.call(owner,'/api/approvals/batch-review',forged)).status,409)
  assert.throws(()=>f.sql.prepare('DELETE FROM household_approval_review_batches').run(),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare("UPDATE household_approval_review_batches SET decision='reject'").run(),/IMMUTABLE/)
 }finally{f.close()}
})
test('mixed reviewed, duplicate, version drift, expired, cross family, inactive member all abort every row',async()=>{
 for(const mode of ['reviewed','duplicate','version','expired','cross','disabled','audit']){
  const f=fixture();try{
   const a=await f.item(4),b=await f.item(5),c=await f.item(6)
   const items=[a,b,c]
   if(mode==='reviewed')assert.equal((await f.call(owner,'/api/approvals/'+b.request_id+'/review',{decision:'approve'})).status,200)
   if(mode==='duplicate')items[2]={...items[0]}
   if(mode==='version')items[1]={...items[1],expected_version:99}
   if(mode==='expired'){f.sql.prepare('UPDATE household_approval_requests SET expires_at=created_at+1 WHERE request_id=?').run(b.request_id);await new Promise(resolve=>setTimeout(resolve,15))}
   if(mode==='cross')items[1]={...items[1],request_id:crypto.randomUUID()}
   if(mode==='disabled')f.sql.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(Date.now(),'member')
   if(mode==='audit')f.sql.exec("CREATE TRIGGER abort_batch_actor BEFORE INSERT ON household_approval_events WHEN NEW.action='approved' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE'); END;")
   const before=count(f.sql,'household_approval_events')
   const result=await f.call(owner,'/api/approvals/batch-review',f.payload(items))
   assert.notEqual(result.status,200,mode)
   assert.equal(count(f.sql,'household_approval_review_batches'),0,mode)
   assert.equal(count(f.sql,'household_approval_events'),before,mode)
   assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(a.request_id).status,'pending',mode)
  }finally{f.close()}
 }
})
test('member, forged role, foreign household, disabled owner, missing flag cannot bulk approve',async()=>{
 const f=fixture();try{
  const items=[await f.item(7),await f.item(8)],batch=f.payload(items)
  for(const u of [member,stranger,{...member,role:'owner'}])
   assert.notEqual((await f.call(u,'/api/approvals/batch-review',batch)).status,200)
  f.env.APPROVAL_BATCH_REVIEW_ENABLED='false'
  assert.equal((await f.call(owner,'/api/approvals/batch-review',batch)).status,503)
  f.env.APPROVAL_BATCH_REVIEW_ENABLED='true'
  f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('owner')
  assert.notEqual((await f.call(owner,'/api/approvals/batch-review',batch)).status,200)
  assert.equal(count(f.sql,'household_approval_review_batches'),0)
  assert.equal(count(f.sql,'household_approval_events'),2)
 }finally{f.close()}
})
