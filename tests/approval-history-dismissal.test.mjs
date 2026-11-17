import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {approvalRoute} from '../worker/approvals.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const ids=['c5d19260-ccac-4138-9cc5-68cf2487a9f7','a4458e4f-c1a3-40bd-9cdf-2e8ce3e0ba46','5cbb37db-b1cf-4f36-83c1-8125e49befa0']
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT);
 CREATE TABLE household_approval_requests(request_id TEXT PRIMARY KEY,household_id TEXT,
 requester_user_id TEXT,source_app TEXT,target_app TEXT,resource_type TEXT,
 operation TEXT,status TEXT,approver_user_id TEXT);
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('other',NULL);
 INSERT INTO household_members VALUES('house','owner','owner'),('house','member','member'),('elsewhere','other','owner');`)
 sql.exec(read('migrations/0062_dismissed_applied_approval_history.sql'))
 sql.exec(read('migrations/0063_expand_applied_ledger_approval_dismissal.sql'))
 const insert=(id,status,operation='finance.entry.create')=>sql.prepare('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,'house','member','kakebo','kakebo','shared_entry_mutation',operation,status,status==='applied'?'owner':null)
 insert(ids[0],'applied');insert(ids[1],'pending');insert(ids[2],'applied','finance.sbi_cash.tsumitate')
 const db={prepare:q=>({bind(...args){return{first:async()=>sql.prepare(q).get(...args)||null,
 run:async()=>({meta:{changes:Number(sql.prepare(q).run(...args).changes)}})}}})}
 const env={APPROVALS_ENABLED:'true',DB:db}
 async function remove(id,user='owner',origin=true,household='house'){
  const url='https://homeflow.test/api/approvals/'+id+'/history'
  const request=new Request(url,{method:'DELETE',headers:origin?{origin:'https://homeflow.test'}:{}})
  const result=await approvalRoute(request,env,new URL(url).pathname,{user_id:user,household_id:household})
  return result.status
 }
 return {sql,remove}
}
test('applied shared approval can be dismissed idempotently without changing original record',async()=>{
 const f=fixture()
 try{
  assert.equal(await f.remove(ids[0]),200)
  assert.equal(await f.remove(ids[0]),200)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM household_approval_dismissed_history').get().n,1)
  assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(ids[0]).status,'applied')
  assert.throws(()=>f.sql.exec('DELETE FROM household_approval_dismissed_history'),/IMMUTABLE/)
  assert.throws(()=>f.sql.exec('UPDATE household_approval_dismissed_history SET dismissed_at=1'),/IMMUTABLE/)
 }finally{f.sql.close()}
})
test('no pending, non-ledger, cross-account or cross-origin history removal',async()=>{
 const f=fixture()
 try{
  assert.equal(await f.remove(ids[1]),409)
  assert.equal(await f.remove(ids[2]),409)
  assert.equal(await f.remove(ids[0],'member'),403)
  assert.equal(await f.remove(ids[0],'other',true,'elsewhere'),404)
  assert.equal(await f.remove(ids[0],'owner',false),403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM household_approval_dismissed_history').get().n,0)
  assert.throws(()=>f.sql.prepare('INSERT INTO household_approval_dismissed_history VALUES(?,?,?,?)').run(ids[1],'house','owner',Date.now()),/OWNER_AND_APPLIED_REQUIRED/)
 }finally{f.sql.close()}
})
test('both approval feeds filter dismissed requests, and only applied rows expose swipe delete',()=>{
 for(const p of ['worker/household-approval-list.js','worker/approvals.js']){
  const src=read(p)
  assert.match(src,/NOT EXISTS \(SELECT 1 FROM household_approval_dismissed_history d/)
 }
 const src=read('src/components/FamilyApprovalFeed.vue')
 assert.match(src,/:allow-delete="canDismiss\(row\)"/)
 assert.match(src,/row\.status==='applied'/)
 assert.match(src,/@delete="dismissHistory\(row\)"/)
 assert.match(src,/method:'DELETE'/)
 assert.match(src,/记账本里的正式明细不会删除/)
})
test('backup remains accessible with a compact download row and 44px touch targets',()=>{
 const src=read('src/components/BackupPanel.vue')
 assert.match(src,/\.backup-heading \+ \.backup-section\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)
 assert.match(src,/\.backup-restore-entry\{width:100%;min-height:44px/)
 assert.match(src,/\.backup-download,\.backup-restore\{display:flex[\s\S]*min-height:44px/)
 assert.match(src,/EditBottomSheet v-if="restoreSheetOpen"/)
})

test('all applied household-ledger review types can be hidden without affecting the ledger',async()=>{
 const f=fixture()
 try{
  const variants=[
   ['kakebo','finance_entry','finance.entry.create'],
   ['kakebo','credit_card_purchase','finance.credit_card.purchase'],
   ['kakebo','prepaid_action','finance.prepaid.spend'],
   ['jp-document-assistant','document_sync_candidate','document.sync.finance'],
   ['kakebo','shared_entry_mutation','finance.entry.restore']
  ]
  const insert=f.sql.prepare('INSERT INTO household_approval_requests VALUES(?,?,?,?,?,?,?,?,?)')
  for(const [source,resource,operation] of variants){
   const id=crypto.randomUUID()
   insert.run(id,'house','member',source,'kakebo',resource,operation,'applied','owner')
   assert.equal(await f.remove(id),200,source+':'+operation)
   assert.equal(await f.remove(id),200,'idempotent '+operation)
   assert.equal(f.sql.prepare('SELECT status FROM household_approval_requests WHERE request_id=?').get(id).status,'applied')
  }
  const id=crypto.randomUUID()
  insert.run(id,'house','member','kakebo','kakebo','credit_card_settlement','finance.credit_card.settlement','applied','owner')
  assert.equal(await f.remove(id),409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_approval_dismissed_history').get().n,variants.length)
  assert.throws(()=>f.sql.exec('DELETE FROM household_approval_dismissed_history'),/IMMUTABLE/)
 }finally{f.sql.close()}
})
test('legacy owner-review entrypoints are retired; legitimate recurring receipts remain routed',()=>{
 const index=read('worker/index.js'),ui=read('src/components/FamilyApprovalFeed.vue')
 for(const path of ['/api/internal/cross-member/consent-submit','/api/internal/recurring-finance/policy-submit',
  '/api/finance-cross-member/consents','/api/recurring-finance/policies'])
  assert.ok(index.includes(path),'legacy path '+path)
 assert.ok(index.includes("error:'legacy_financial_approval_retired'"))
 assert.ok(index.includes('/api/internal/recurring-finance/reserve'))
 assert.ok(index.includes('/api/internal/recurring-finance/receipt'))
 for(const kind of ['finance_entry','credit_card_purchase','prepaid_action','document_sync_candidate'])
  assert.ok(ui.includes("row.resource_type==='"+kind+"'"))
 assert.ok(ui.includes("execute:'核对原申请'"))
})
