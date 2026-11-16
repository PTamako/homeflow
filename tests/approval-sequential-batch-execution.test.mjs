import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {executeApprovedBatch} from '../src/approval-batch-execution.mjs'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const receipt=n=>({ok:true,applied:true,status:'applied',approval_id:id(n),remote_id:'original-entry:'+n})
test('batch finance execution is strictly sequential, at most 10 approved original IDs, never a cross-D1 atomic promise',async()=>{
 const called=[]
 const result=await executeApprovedBatch([id(1),id(2),id(3)],async original=>{
  // async boundary proves all previous callbacks completed before next.
  assert.equal(called.length,[id(1),id(2),id(3)].indexOf(original))
  called.push(original);return receipt(called.length)
 },()=>true)
 assert.equal(result.ok,true)
 assert.deepEqual(result.applied,[id(1),id(2),id(3)])
 assert.deepEqual(called,result.applied)
 assert.equal((await executeApprovedBatch(Array.from({length:11},(_,i)=>id(i+1)),async()=>receipt(1),()=>true)).code,'invalid_original_approval_set')
 assert.equal((await executeApprovedBatch([id(1),id(1)],async()=>receipt(1),()=>true)).code,'invalid_original_approval_set')
})
test('one ambiguous target commit stops before next original ID; no background automatic retry',async()=>{
 const called=[]
 const result=await executeApprovedBatch([id(1),id(2),id(3)],async original=>{
  called.push(original)
  if(original===id(2))throw Error('unknown network result')
  return receipt(1)
 },()=>true)
 assert.equal(result.ok,false)
 assert.equal(result.code,'target_result_unknown')
 assert.equal(result.stopped_at,id(2))
 assert.deepEqual(result.applied,[id(1)])
 assert.deepEqual(called,[id(1),id(2)])
})
test('switched PWA identity or mismatched finance receipt immediately halts subsequent executions',async()=>{
 let current=true
 const switched=await executeApprovedBatch([id(1),id(2)],async()=>{
  current=false;return receipt(1)
 },()=>current)
 assert.equal(switched.code,'actor_changed')
 assert.equal(switched.stopped_at,id(1))
 assert.deepEqual(switched.applied,[])
 let count=0
 const mismatched=await executeApprovedBatch([id(1),id(2)],async()=>{count++;return receipt(99)},()=>true)
 assert.equal(mismatched.code,'receipt_unconfirmed')
 assert.equal(count,1)
})
test('UI only executes previously approved and supported finance actions after one explicit consent',()=>{
 const source=readFileSync(new URL('../src/components/ApprovalCenter.vue',import.meta.url),'utf8')
 assert.match(source,/selectedExecutions\.value\.length>10/)
 assert.match(source,/selected\.some\(p=>!items\.value\.some/)
 assert.match(source,/canExecute\(x\)/)
 assert.match(source,/confirmAction\(\{[\s\S]*?不是跨数据库原子批量事务/)
 assert.match(source,/executeApprovedBatch\(selected\.map\(x=>x\.id\)/)
 assert.match(source,/getJson\('\/api\/approvals\/'\+id\+'\/execute'/)
 assert.match(source,/按原 ID 逐笔实际入账/)
 assert.doesNotMatch(source,/Promise\.all\(selected\.map/)
})
