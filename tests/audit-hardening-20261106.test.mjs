import assert from 'node:assert/strict'
import test from 'node:test'
import {todayPlansRoute} from '../worker/plan-today.js'
import {goalPeriodsRoute} from '../worker/goal-settlements.js'
import {goalPeriodArchiveRoute} from '../worker/goal-period-archive.js'
import {pushRoute,runPushSchedule,scheduledNotificationId} from '../worker/webpush.js'
import {readFileSync} from 'node:fs'

const actor='11111111-1111-4111-8111-111111111111'
const recipient='22222222-2222-4222-8222-222222222222'
const goalId='33333333-3333-4333-8333-333333333333'
const base='https://homeflow.invalid'
const member={household_id:'family',user_id:actor,role:'member'}
const target={id:goalId,household_id:'family',created_by:recipient,
  visibility:'household',goal_mode:'monthly',start_on:'2026-01-01',
  target_on:null,target_amount:60000}
const post=(path,body)=>new Request(base+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
})

test('legacy goal completion rejects non-owner before any ledger request or data mutation',async()=>{
 let reads=0,writes=0,ledgerCalls=0
 const db={prepare(){reads++;return {bind(){return {
   first:async()=>target,
   run:async()=>{writes++;throw Error('forbidden write')},
   all:async()=>{throw Error('unexpected broad query')}
 }}}}}
 const env={DB:db,KAKEBO_LEDGER_SERVICE:{fetch(){ledgerCalls++;throw Error('forbidden ledger')}}}
 const path='/api/plans/complete'
 const r=await todayPlansRoute(post(path,{kind:'goal',id:goalId,
   periodKey:'2026-10',completed:true}),db,member,path,env)
 assert.equal(r.status,403)
 assert.equal(reads,1)
 assert.equal(writes,0)
 assert.equal(ledgerCalls,0)
})

test('same-day recurring goal cannot settle via legacy route and returns 409',async()=>{
 const now=new Date(Date.now()+9*3600000).toISOString().slice(0,7)
 const db={prepare(){return {bind(){return {first:async()=>target}}}}}
 const path='/api/plans/complete'
 const r=await todayPlansRoute(post(path,{kind:'goal',id:goalId,
   periodKey:now,completed:true}),db,{...member,role:'owner'},path,{DB:db})
 assert.equal(r.status,409)
 assert.equal((await r.json()).error,'not_due')
})

test('period history and archive do not expose household financial estimates to members',async()=>{
 let writes=0
 const db={prepare(){return {bind(){return {
   first:async()=>target,run:async()=>{writes++;throw Error('unexpected mutation')}
 }}}}}
 const detail='/api/goals/'+goalId+'/periods'
 const r=await goalPeriodsRoute(new Request(base+detail),{DB:db},detail,member)
 assert.equal(r.status,403)
 const archive=await goalPeriodArchiveRoute(
   new Request(base+'/api/goals/period-archive'),db,member)
 assert.equal(archive.status,403)
 assert.equal(writes,0)
})

test('family messages without Push remain as two separate in-app notifications',async()=>{
 const writes=[],reads=[]
 const db={prepare(sql){return {bind(...args){reads.push(sql);return {
   first:async()=>sql.includes('FROM household_members')?{user_id:recipient}:null,
   all:async()=>({results:[]}),
   run:async()=>{writes.push({sql,args});return {meta:{changes:1}}}
 }}}}}
 // Missing VAPID is allowed for app-inbox-only messaging; no external Push calls.
 const env={DB:db}
 const path='/api/push/send-family'
 const send=msg=>pushRoute(post(path,{recipientUserId:recipient,message:msg}),env,path,member)
 const a=await send('记得拿钥匙'),b=await send('还有雨伞')
 assert.equal(a.status,200)
 assert.equal(b.status,200)
 assert.equal((await a.json()).inAppOnly,true)
 assert.equal((await b.json()).inAppOnly,true)
 const notices=writes.filter(x=>x.sql.includes('INSERT INTO notification_inbox'))
 assert.equal(notices.length,2)
 assert.notEqual(notices[0].args[0],notices[1].args[0])
 assert.equal(notices[0].args[3],recipient)
 assert.equal(notices[1].args[3],recipient)
 assert.equal(notices[0].args[9],0)
 assert.equal(notices[1].args[9],0)
})

test('Today sorts merged sources by due date before applying five-row slice',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(app,/dueOn\(a\)\.localeCompare\(dueOn\(b\)\)/)
 assert.match(app,/a\.key\.localeCompare\(b\.key\)/)
 assert.match(app,/Number\(a\.done\)-Number\(b\.done\)/)
 assert.match(app,/unifiedToday\.value\.slice\(0,todayVisibleCount\.value\)/)
})

test('scheduled notice IDs are stable per account, day and reminder key',async()=>{
 const a=await scheduledNotificationId(actor,'2026-11-06','task:abc:2026-11-06:0')
 const b=await scheduledNotificationId(actor,'2026-11-06','task:abc:2026-11-06:0')
 assert.equal(a,b)
 assert.match(a,/^[0-9a-f-]{36}$/)
 assert.notEqual(a,await scheduledNotificationId(actor,'2026-11-07','task:abc:2026-11-06:0'))
 assert.notEqual(a,await scheduledNotificationId(recipient,'2026-11-06','task:abc:2026-11-06:0'))
})

test('06:00 in-app reminder exists without VAPID or any device subscription',async()=>{
 const now=Date.parse('2026-11-05T21:00:00.000Z'),day='2026-11-06'
 const records=[]
 const db={
   prepare(sql){
     const q={
       args:[],
       bind(...args){this.args=args;return this},
       all:async()=>({results:sql.includes('FROM household_members m JOIN users u')
         ?[{user_id:actor,household_id:'family'}]:[]}),
       run:async()=>{records.push({sql,args:q.args});return {meta:{changes:1}}}
     }
     return q
   },
   async batch(statements){
     const rows=Array.from({length:11},()=>({results:[]}))
     rows[3]={results:[{id:goalId,title:'喂豆沙',due_on:day}]}
     return rows
   }
 }
 const env={DB:db,APP_ENV:'production'}
 const first=await runPushSchedule(env,now),second=await runPushSchedule(env,now)
 assert.equal(first.sent,0)
 assert.equal(first.inbox,1)
 assert.equal(second.inbox,1)
 const notices=records.filter(x=>x.sql.includes('INSERT INTO notification_inbox'))
 assert.equal(notices.length,2)
 assert.equal(notices[0].args[0],notices[1].args[0])
 assert.equal(notices[0].args[3],actor)
 assert.equal(notices[0].args[11],day)
})
