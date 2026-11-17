import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('owner-deleted, already-applied household approvals are hidden without changing immutable history',()=>{
 const db=new DatabaseSync(':memory:')
 try{
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER)")
  db.exec("CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT)")
  db.exec("CREATE TABLE household_approval_requests(request_id TEXT PRIMARY KEY,household_id TEXT,source_app TEXT,target_app TEXT,resource_type TEXT,operation TEXT,status TEXT,approver_user_id TEXT)")
  db.exec(read('migrations/0061_hidden_deleted_shared_approval_history.sql'))
  db.exec("INSERT INTO users(id,disabled_at) VALUES('owner',NULL),('member',NULL)")
  db.exec("INSERT INTO household_members VALUES('primary','owner','owner'),('primary','member','member')")
  db.exec("INSERT INTO household_approval_requests VALUES('old','primary','kakebo','kakebo','shared_entry_mutation','finance.entry.create','applied','owner')")
  db.exec("INSERT INTO household_approval_requests VALUES('new','primary','kakebo','kakebo','shared_entry_mutation','finance.entry.create','pending',NULL)")
  db.prepare("INSERT INTO household_approval_hidden_history VALUES(?,?,?,?,?)").run('old','primary','owner','owner_deleted_shared_entry_for_retest',Date.now())
  assert.deepEqual(db.prepare("SELECT request_id FROM household_approval_requests a WHERE NOT EXISTS (SELECT 1 FROM household_approval_hidden_history h WHERE h.request_id=a.request_id AND h.household_id=a.household_id) ORDER BY request_id").all().map(x=>x.request_id),['new'])
  assert.equal(db.prepare("SELECT status FROM household_approval_requests WHERE request_id='old'").get().status,'applied')
  assert.throws(()=>db.exec("DELETE FROM household_approval_hidden_history"),/IMMUTABLE/)
  assert.throws(()=>db.exec("UPDATE household_approval_hidden_history SET hidden_at=1"),/IMMUTABLE/)
  assert.throws(()=>db.prepare("INSERT INTO household_approval_hidden_history VALUES(?,?,?,?,?)").run('new','primary','owner','owner_deleted_shared_entry_for_retest',Date.now()),/OWNER_AND_APPLIED_REQUIRED/)
 }finally{db.close()}
})
test('both owner review feeds exclude hidden history and retain list pagination',()=>{
 const list=read('worker/household-approval-list.js')
 const approvals=read('worker/approvals.js')
 for(const text of [list,approvals]){
  assert.match(text,/NOT EXISTS \(SELECT 1 FROM household_approval_hidden_history h/)
  assert.match(text,/h\.request_id=household_approval_requests\.request_id/)
  assert.match(text,/h\.household_id=household_approval_requests\.household_id/)
 }
 assert.match(list,/PAGE_SIZE=5/)
})
