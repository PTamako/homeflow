import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {householdApprovalListRoute} from '../worker/household-approval-list.js'
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT);
 CREATE TABLE household_approval_hidden_history(request_id TEXT PRIMARY KEY,household_id TEXT);
 CREATE TABLE household_approval_dismissed_history(request_id TEXT PRIMARY KEY,household_id TEXT);
 CREATE TABLE household_approval_requests(
  request_id TEXT,household_id TEXT,requester_user_id TEXT,status TEXT,
  created_at INTEGER,expires_at INTEGER,version INTEGER,
  operation TEXT,source_app TEXT,resource_type TEXT);
 CREATE TABLE household_recurring_finance_policies(
  policy_id TEXT,household_id TEXT,member_user_id TEXT,status TEXT,
  created_at INTEGER,expires_at INTEGER,version INTEGER,
  plan_type TEXT,max_amount_jpy INTEGER,due_day INTEGER,
  start_month TEXT,end_month TEXT);
 CREATE TABLE household_cross_member_transfer_consents(
  consent_id TEXT,household_id TEXT,source_user_id TEXT,recipient_user_id TEXT,
  owner_authorizer_user_id TEXT,status TEXT,created_at INTEGER,
  expires_at INTEGER,version INTEGER);
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('other',NULL),
  ('foreign-owner',NULL),('disabled',100);
 INSERT INTO household_members VALUES('home','owner','owner'),
  ('home','member','member'),('home','disabled','owner'),
  ('foreign','foreign-owner','owner');`)
 const insert=(q,...x)=>sql.prepare(q).run(...x)
 const now=Date.now(),expires=now+86400000
 for(let i=0;i<9;i++){
  insert('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?,?,?)',
   'approval-'+i,'home','member',i<3?'pending':'approved',now-i*1000,expires,
   1,'finance.entry.create','kakebo','finance_entry')
 }
 for(let i=0;i<3;i++){
  insert('INSERT INTO household_recurring_finance_policies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
   'policy-'+i,'home','member',i<2?'pending_owner':'approved',
   now-500+i*500,expires,1,'fixed_cost',15000,27,'2026-11','2027-10')
 }
 for(let i=0;i<3;i++){
  insert('INSERT INTO household_cross_member_transfer_consents VALUES(?,?,?,?,?,?,?,?,?)',
   'consent-'+i,'home','member','owner',null,
   i===0?'recipient_accepted':i===1?'awaiting_recipient':'owner_authorized',
   now-2000-i*1000,expires,1)
 }
 insert('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?,?,?)',
   'foreign-approval','foreign','foreign-owner','pending',now+99999,expires,1,
   'finance.entry.create','kakebo','finance_entry')
 // The production approval table has this nullable last_error_code column.
 sql.exec('ALTER TABLE household_approval_requests ADD COLUMN last_error_code TEXT')
 const db={prepare:q=>({bind(...v){return{
  first:async()=>sql.prepare(q).get(...v)||null,
  all:async()=>({results:sql.prepare(q).all(...v)})
 }}})}
 const env={APPROVALS_ENABLED:'true',RECURRING_FINANCE_AUTH_ENABLED:'true',
  CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED:'true',DB:db}
 async function call(page='0',user='owner',household='home'){
  const path='/api/household-approvals'
  const response=await householdApprovalListRoute(
   new Request('https://homeflow.test'+path+'?page='+page),env,path,
   {user_id:user,household_id:household})
  return {status:response.status,data:await response.json()}
 }
 return {sql,env,call,close:()=>sql.close()}
}
test('owner approval timeline contains only household ledger mutations (not recurring plans or personal consents)',async()=>{
 const f=fixture()
 try{
  const pages=await Promise.all([f.call('0'),f.call('1'),f.call('2')])
  for(const row of pages)assert.equal(row.status,200,JSON.stringify(row.data))
  assert.deepEqual(pages.map(x=>x.data.items.length),[5,4,0])
  assert.deepEqual(pages.map(x=>x.data.has_more),[true,false,false])
  assert.deepEqual(pages.map(x=>x.data.page_size),[5,5,5])
  const all=pages.flatMap(x=>x.data.items)
  assert.equal(new Set(all.map(x=>x.kind+':'+x.id)).size,9)
  assert.deepEqual(new Set(all.map(x=>x.kind)),new Set(['approval']))
  assert.ok(all.every(x=>x.operation.startsWith('finance.entry.')))
  assert.ok(!all.some(x=>x.id.startsWith('policy-')||x.id.startsWith('consent-')))
  assert.ok(all.slice(0,3).every(x=>x.status==='pending'))
  assert.ok(all.every(x=>!('payload_sha256' in x)&&!('source_reference_hash' in x)&&
   !('bank_account_number' in x)&&!('priority' in x)))
 }finally{f.close()}
})
test('a member, a disabled owner and a mismatched household cannot read owner-only items',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.call('0','member')).status,403)
  assert.equal((await f.call('0','disabled')).status,403)
  const outsider=await f.call('0','foreign-owner','foreign')
  assert.equal(outsider.status,200)
  assert.deepEqual(outsider.data.items.map(x=>x.id),['foreign-approval'])
  const authorized=await f.call()
  assert.ok(authorized.data.items.every(x=>x.id!=='foreign-approval'))
 }finally{f.close()}
})
test('invalid page, feature disabled, and optional workflow flags fail closed without writes',async()=>{
 const f=fixture()
 try{
  for(const v of ['-1','2.5','9999','garbage'])
   assert.equal((await f.call(v)).status,400)
  f.env.RECURRING_FINANCE_AUTH_ENABLED='false'
  f.env.CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED='false'
  const result=await f.call()
  assert.equal(result.status,200)
  assert.ok(result.data.items.every(x=>x.kind==='approval'))
  f.env.APPROVALS_ENABLED='false'
  assert.equal((await f.call()).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_requests').get().n,10)
 }finally{f.close()}
})

test('expired pending family requests are retained for audit but never hide actionable approvals on page one',async()=>{
 const f=fixture()
 try{
  const past=Date.now()-60000
  f.sql.prepare("UPDATE household_approval_requests SET expires_at=? WHERE request_id='approval-0'").run(past)
  f.sql.prepare("UPDATE household_recurring_finance_policies SET expires_at=? WHERE policy_id='policy-1'").run(past)
  f.sql.prepare("UPDATE household_cross_member_transfer_consents SET expires_at=? WHERE consent_id='consent-1'").run(past)
  const pages=await Promise.all([f.call('0'),f.call('1'),f.call('2')])
  const first=pages[0].data.items
  assert.equal(first.length,5)
  assert.ok(first.every(x=>!(x.expires_at<=Date.now()&&['pending','pending_owner','awaiting_recipient','recipient_accepted'].includes(x.status))))
  const all=pages.flatMap(x=>x.data.items)
  assert.equal(all.length,9)
  assert.ok(all.some(x=>x.id==='approval-0'))
  assert.ok(!all.some(x=>x.id==='policy-1'||x.id==='consent-1'))
  assert.deepEqual(pages.map(x=>x.data.has_more),[true,false,false])
 }finally{f.close()}
})


test('cancelled duplicate retest is hidden without suppressing the newer pending request',async()=>{
 const f=fixture()
 try{
  const request='approval-3'
  f.sql.prepare("UPDATE household_approval_requests SET status='cancelled',last_error_code='duplicate_retest_superseded' WHERE request_id=?").run(request)
  const pages=await Promise.all([f.call('0'),f.call('1')])
  assert.equal(pages[0].status,200,JSON.stringify(pages[0].data))
  assert.equal(pages[1].status,200,JSON.stringify(pages[1].data))
  const visible=pages.flatMap(x=>x.data.items)
  assert.equal(visible.length,8)
  assert.equal(visible.some(x=>x.id===request),false)
  assert.equal(visible.some(x=>x.id==='approval-0'),true)
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(request).status,'cancelled')
  assert.deepEqual(pages.map(x=>x.data.items.length),[5,3])
 }finally{f.close()}
})
