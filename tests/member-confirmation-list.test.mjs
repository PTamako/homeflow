import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {memberConfirmationListRoute} from '../worker/member-confirmation-list.js'

function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, disabled_at INTEGER);
 CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT);
 CREATE TABLE household_approval_requests(
 request_id TEXT,household_id TEXT,requester_user_id TEXT,status TEXT,
 created_at INTEGER,expires_at INTEGER,version INTEGER,operation TEXT);
 CREATE TABLE household_recurring_finance_policies(
 policy_id TEXT,household_id TEXT,member_user_id TEXT,status TEXT,
 created_at INTEGER,expires_at INTEGER,version INTEGER,plan_type TEXT,
 max_amount_jpy INTEGER,due_day INTEGER,start_month TEXT,end_month TEXT);
 CREATE TABLE household_cross_member_transfer_consents(
 consent_id TEXT,household_id TEXT,source_user_id TEXT,recipient_user_id TEXT,
 status TEXT,created_at INTEGER,expires_at INTEGER,version INTEGER);
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('other',NULL),
 ('foreign-member',NULL),('disabled',123);
 INSERT INTO household_members VALUES('home','owner','owner'),
 ('home','member','member'),('home','other','member'),
 ('foreign','foreign-member','member'),('home','disabled','member');`)
 const run=(q,...args)=>sql.prepare(q).run(...args)
 const now=Date.now(),future=now+10000000,past=now-10000000
 for(let i=0;i<8;i++){
  run('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?)',
    'mine-'+i,'home','member',i<6?'pending':'approved',now-i*1000,future,1,'finance.entry.create')
 }
 run('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?)',
  'other-private','home','other','pending',now+100,future,1,'finance.entry.create')
 run('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?)',
  'foreign-private','foreign','foreign-member','pending',now+200,future,1,'finance.entry.create')
 run('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?)',
  'expired','home','member','pending',now,past,1,'finance.entry.create')
 run('INSERT INTO household_recurring_finance_policies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  'my-plan','home','member','pending_owner',now-10,future,1,'fixed_cost',15000,27,'2026-11','2027-10')
 run('INSERT INTO household_recurring_finance_policies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  'approved-plan','home','member','approved',now-20,future,2,'sbi_tsumitate',15000,15,'2026-11','2027-10')
 run('INSERT INTO household_cross_member_transfer_consents VALUES(?,?,?,?,?,?,?,?)',
  'source-waiting','home','member','owner','awaiting_recipient',now-30,future,1)
 run('INSERT INTO household_cross_member_transfer_consents VALUES(?,?,?,?,?,?,?,?)',
  'source-cancel','home','member','owner','recipient_accepted',now-40,future,2)
 run('INSERT INTO household_cross_member_transfer_consents VALUES(?,?,?,?,?,?,?,?)',
  'not-mine','home','other','owner','awaiting_recipient',now-50,future,1)
 const DB={prepare(q){return{bind(...values){return{
  first:async()=>sql.prepare(q).get(...values)||null,
  all:async()=>({results:sql.prepare(q).all(...values)})}}}}}
 const env={DB,APPROVALS_ENABLED:'true',
  RECURRING_FINANCE_AUTH_ENABLED:'true',
  CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED:'true'}
 async function request(user='member',household='home',page='0'){
  const path='/api/my-confirmations'
  const response=await memberConfirmationListRoute(
   new Request('https://homeflow.test'+path+'?page='+page),env,path,
   {user_id:user,household_id:household})
  return {status:response.status,body:await response.json()}
 }
 return {sql,env,request,close:()=>sql.close()}
}
test('member sees only self-owned actionable pending approvals, plans and consent, five per page',async()=>{
 const f=fixture()
 try{
  const first=await f.request('member','home','0')
  const second=await f.request('member','home','1')
  assert.equal(first.status,200)
  assert.equal(second.status,200)
  assert.equal(first.body.items.length,5)
  assert.equal(second.body.items.length,4)
  assert.equal(first.body.page_size,5)
  assert.equal(first.body.has_more,true)
  assert.equal(second.body.has_more,false)
  const all=[...first.body.items,...second.body.items]
  assert.equal(new Set(all.map(x=>x.kind+':'+x.id)).size,9)
  assert.deepEqual(new Set(all.map(x=>x.kind)),new Set(['approval','recurring','consent']))
  for(const id of ['other-private','foreign-private','expired','approved-plan','not-mine','mine-6','mine-7'])
   assert.ok(!all.some(x=>x.id===id),id+' must not appear')
  for(const x of all){
   assert.ok(x.actor_user_id==='member'||x.recipient_user_id==='member')
   assert.ok(['pending','pending_owner','awaiting_recipient','recipient_accepted'].includes(x.status))
   assert.ok(!Object.hasOwn(x,'priority'))
   assert.ok(!Object.hasOwn(x,'payload_sha256'))
  }
 }finally{f.close()}
})
test('owner cannot read member inbox; other members cannot read another member applications',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.request('owner')).status,403)
  assert.equal((await f.request('disabled')).status,403)
  const other=await f.request('other')
  assert.equal(other.status,200)
  assert.deepEqual(other.body.items.map(x=>x.id).sort(),['not-mine','other-private'])
  const foreign=await f.request('foreign-member','foreign')
  assert.deepEqual(foreign.body.items.map(x=>x.id),['foreign-private'])
 }finally{f.close()}
})
test('malformed pages and disabled flags fail closed, without creating approval records',async()=>{
 const f=fixture()
 try{
  for(const page of ['-1','1.25','201','xyz','00'])
   assert.equal((await f.request('member','home',page)).status,400)
  f.env.RECURRING_FINANCE_AUTH_ENABLED='false'
  f.env.CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED='false'
  const result=await f.request()
  assert.equal(result.status,200)
  assert.ok(result.body.items.every(x=>x.kind==='approval'))
  f.env.APPROVALS_ENABLED='false'
  assert.equal((await f.request()).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) total FROM household_approval_requests').get().total,11)
 }finally{f.close()}
})
