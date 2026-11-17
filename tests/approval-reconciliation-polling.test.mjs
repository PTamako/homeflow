import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {APPROVAL_RECONCILE_POLL_MS,needsApprovalReconciliation,
 createConditionalApprovalPoller} from '../src/approval-reconciliation-polling.mjs'

function clock(){
 const tasks=new Map()
 let last=0
 return {
  schedule(fn,delay){const id=++last;tasks.set(id,{fn,delay});return id},
  cancel(id){tasks.delete(id)},
  get size(){return tasks.size},
  get delays(){return [...tasks.values()].map(x=>x.delay)},
  async fire(){
   const [id,task]=tasks.entries().next().value||[]
   if(!task)return
   tasks.delete(id)
   await task.fn()
  }
 }
}
const row=status=>({kind:'approval',resource_type:'shared_entry_mutation',
 operation:'finance.entry.create',status})
const allowed=x=>x.kind==='approval'&&x.resource_type==='shared_entry_mutation'

test('only unresolved approved, executing, and retryable household ledger requests qualify',()=>{
 for(const state of ['approved','executing','failed_retryable'])
  assert.equal(needsApprovalReconciliation([row(state)],allowed),true,state)
 for(const state of ['pending','applied','rejected','cancelled','failed_final','conflict','expired'])
  assert.equal(needsApprovalReconciliation([row(state)],allowed),false,state)
 assert.equal(needsApprovalReconciliation([{
  ...row('approved'),resource_type:'personal_finance'
 }],allowed),false)
 assert.equal(needsApprovalReconciliation([],allowed),false)
})

test('single 20s timer runs only while unresolved, stops after actual applied acknowledgement',async()=>{
 const clk=clock(),rows=[row('approved')];let requests=0
 const poller=createConditionalApprovalPoller({
  shouldPoll:()=>needsApprovalReconciliation(rows,allowed),
  onRefresh:async()=>{requests++;rows[0]=row('applied')},
  schedule:clk.schedule,cancel:clk.cancel
 })
 poller.sync()
 assert.equal(clk.size,1)
 assert.deepEqual(clk.delays,[20000])
 poller.sync()
 assert.equal(clk.size,1,'never stack multiple polling timers')
 assert.equal(requests,0)
 await clk.fire()
 assert.equal(requests,1)
 assert.equal(clk.size,0,'confirmed applied request stops further D1 reads')
 poller.sync()
 assert.equal(clk.size,0)
 poller.dispose()
})

test('reject and cancel stop without attempting a financial execution',async()=>{
 for(const terminal of ['rejected','cancelled','failed_final']){
  const clk=clock(),rows=[row('failed_retryable')];let calls=0
  const poller=createConditionalApprovalPoller({
   shouldPoll:()=>needsApprovalReconciliation(rows,allowed),
   onRefresh:async()=>{calls++;rows[0]=row(terminal)},
   schedule:clk.schedule,cancel:clk.cancel
  })
  poller.sync();await clk.fire()
  assert.equal(calls,1)
  assert.equal(clk.size,0,terminal)
  poller.dispose()
 }
})

test('foreground-only, account-switch, and tab-close cancel pending refresh; returning visible can resume',async()=>{
 const clk=clock();let active=true,visible=true,owner=true,userId='owner',refreshes=0
 const rows=[row('executing')]
 const poller=createConditionalApprovalPoller({
  shouldPoll:()=>active&&visible&&owner&&userId==='owner'&&needsApprovalReconciliation(rows,allowed),
  onRefresh:async()=>{refreshes++},
  schedule:clk.schedule,cancel:clk.cancel
 })
 poller.sync();assert.equal(clk.size,1)
 visible=false;poller.sync();assert.equal(clk.size,0)
 visible=true;poller.sync();assert.equal(clk.size,1)
 active=false;poller.sync();assert.equal(clk.size,0)
 active=true;owner=false;poller.sync();assert.equal(clk.size,0)
 owner=true;userId='member';poller.sync();assert.equal(clk.size,0)
 userId='owner';poller.sync();assert.equal(clk.size,1)
 await clk.fire();assert.equal(refreshes,1);assert.equal(clk.size,1)
 poller.dispose();assert.equal(clk.size,0)
 poller.sync();assert.equal(clk.size,0)
})

test('no overlapping reads during an unresolved async refresh',async()=>{
 const clk=clock(),rows=[row('approved')]
 let finish,started=0
 const poller=createConditionalApprovalPoller({
  shouldPoll:()=>needsApprovalReconciliation(rows,allowed),
  onRefresh:async()=>{started++;await new Promise(resolve=>finish=resolve)},
  schedule:clk.schedule,cancel:clk.cancel
 })
 poller.sync()
 const request=clk.fire()
 await Promise.resolve()
 assert.equal(started,1)
 poller.sync()
 assert.equal(clk.size,0)
 rows[0]=row('applied');finish();await request
 assert.equal(clk.size,0)
 poller.dispose()
})

test('both HomeFlow approval screens use conditional timer and read-only fetch only',()=>{
 const family=readFileSync(new URL('../src/components/FamilyApprovalFeed.vue',import.meta.url),'utf8')
 const center=readFileSync(new URL('../src/components/ApprovalCenter.vue',import.meta.url),'utf8')
 for(const source of [family,center]){
  assert.match(source,/createConditionalApprovalPoller/)
  assert.match(source,/needsApprovalReconciliation/)
  assert.match(source,/document.visibilityState==='visible'/)
  assert.match(source,/\.dispose\(\)/)
  assert.doesNotMatch(source,/setInterval\(/)
 }
 assert.match(family,/row.kind==='approval'&&isSharedLedger\(row\)/)
 assert.match(family,/onRefresh:\(\)=>load\(page.value,true\)/)
 assert.match(center,/watchedApprovalIds\.value\.length>0/)
 assert.match(center,/getJson\('\/api\/approvals\/'\+encodeURIComponent\(id\)\)/)
 const statusOnly=center.slice(center.indexOf('onRefresh:async()=>{'),
  center.indexOf('function refreshOnReturn(){'))
 assert(statusOnly.includes("getJson('/api/approvals/'+encodeURIComponent(id))"))
 assert.doesNotMatch(statusOnly,/\/execute|method:'POST'/)
})
