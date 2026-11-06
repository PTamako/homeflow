import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {savingsReminders} from '../worker/savings-reminders.js'
import {remindersRoute,reminderDeliveryKey} from '../worker/reminders.js'

const id='11111111-1111-4111-8111-111111111111'
const monthly={id,title:'每月储值',goal_mode:'monthly',start_on:'2026-11-01',
  target_on:null,target_amount:60000}
const yearly={...monthly,title:'年度储值',goal_mode:'yearly',start_on:'2026-01-01'}
const once={...monthly,title:'买钱包',goal_mode:'once',target_on:'2026-11-06'}
const session={household_id:'family-a',user_id:'member-a'}

test('monthly, yearly and once goals have independent reminder dates',()=>{
 const month=savingsReminders([monthly],'2026-11-27')
 assert.equal(month.length,1)
 assert.equal(month[0].stage,'advance')
 assert.equal(month[0].daysBefore,3)
 assert.equal(month[0].periodKey,'2026-11')
 assert.equal(month[0].dueOn,'2026-11-30')
 assert.equal(savingsReminders([monthly],'2026-11-28')[0].notifyToday,false)

 const annual=savingsReminders([yearly],'2026-12-24')
 assert.equal(annual.length,1)
 assert.equal(annual[0].daysBefore,7)
 assert.equal(annual[0].periodKey,'2026')
 assert.equal(annual[0].dueOn,'2026-12-31')

 const due=savingsReminders([once],'2026-11-06')
 assert.equal(due.length,1)
 assert.equal(due[0].stage,'due')
 assert.equal(due[0].periodKey,'once')
 assert.equal(savingsReminders([once],'2026-11-07').length,0)
 assert.equal(savingsReminders([once],'2026-11-06',[],[{plan_id:id,period_key:'once'}]).length,0)
})

test('overdue periods remain financially unverified but do not push every day',()=>{
 const g={...monthly,start_on:'2026-10-01'}
 const due=savingsReminders([g],'2026-11-01')
 assert.equal(due.length,1)
 assert.equal(due[0].stage,'pending')
 assert.equal(due[0].periodKey,'2026-10')
 assert.equal(due[0].priority,'important')
 assert.equal(savingsReminders([g],'2026-11-02')[0].notifyToday,false)
 assert.equal(savingsReminders([g],'2026-11-08').length,1)
 assert.equal(savingsReminders([g],'2026-11-08')[0].stage,'pending')
 assert.equal(savingsReminders([g],'2026-11-08')[0].notifyToday,true)
 assert.equal(savingsReminders([g],'2026-11-01',[],
   [{plan_id:id,period_key:'2026-10'}]).length,0)
})

test('verified settlement results notify once on the next JST morning, without touching balances',()=>{
 const g={...monthly,start_on:'2026-10-01'}
 const actual={goal_id:id,period_key:'2026-10',status:'shortfall',
   difference_amount:25000,settled_at:'2026-11-01T00:30:00Z'}
 const day=savingsReminders([g],'2026-11-02',[actual])
 assert.equal(day.length,1)
 assert.equal(day[0].stage,'result')
 assert.match(day[0].message,/不足 ¥25,000/)
 assert.equal(savingsReminders([g],'2026-11-03',[actual]).length,0)
 const met={...actual,status:'met',difference_amount:-3000}
 assert.match(savingsReminders([g],'2026-11-02',[met])[0].message,/已达标/)
})

test('a manually reviewed monthly result never creates a follow-up push',()=>{
 const g={...monthly,start_on:'2026-10-01'}
 const reviewed={goal_id:id,period_key:'2026-10',status:'shortfall',
   settlement_origin:'manual',difference_amount:13908,settled_at:'2026-11-06T04:16:31.978Z'}
 assert.deepEqual(savingsReminders([g],'2026-11-07',[reviewed]),[])
 assert.deepEqual(savingsReminders([g],'2026-11-08',[reviewed]),[])
 assert.deepEqual(savingsReminders([g],'2026-11-07',[{...reviewed,status:'met'}]),[])
 const automatic={...reviewed,settlement_origin:'scheduled'}
 assert.equal(savingsReminders([g],'2026-11-07',[automatic])[0].stage,'result')
 assert.equal(savingsReminders([g],'2026-11-08',[automatic]).length,0)
})

test('different savings periods and settlement stages have independent notification keys',()=>{
 const g={kind:'goal',id,dueOn:'2026-11-30',periodKey:'2026-11',
   stage:'advance',daysBefore:3}
 assert.equal(reminderDeliveryKey(g),'goal:'+id+':2026-11:advance:2026-11-30:3')
 assert.notEqual(reminderDeliveryKey(g),reminderDeliveryKey({...g,stage:'result'}))
 assert.notEqual(reminderDeliveryKey(g),reminderDeliveryKey({...g,periodKey:'2026-12'}))
 assert.equal(reminderDeliveryKey({kind:'task',id,dueOn:'2026-11-30'}),
   'task:'+id+':2026-11-30:0')
})

function fixture(deliveryKeys=[]){
 const statements=[]
 const goalRows=[{...monthly,household_id:'family-a',visibility:'household'}]
 const db={
  prepare(sql){const query={sql,args:[],bind(...args){this.args=args;return this},
    async all(){statements.push(this);return {results:goalRows}}};return query},
  async batch(q){
   statements.push(...q)
   if(q.length===11||q.length===12){
     const rows=Array.from({length:q.length},()=>({results:[]}))
     if(q.length===12)rows[11]={results:deliveryKeys.map(dedupe_key=>({dedupe_key}))}
     return rows
   }
   if(q.length===2)return [{results:[]},{results:[]}]
   throw Error('Unexpected batch '+q.length)
  }
 }
 return {db,statements}
}
test('savings records are included only in the scheduler and scoped pending view',async()=>{
 const {db,statements}=fixture()
 const date='2026-11-27',base='https://homeflow.invalid/api/reminders?date='+date
 const normal=await remindersRoute(new Request(base),db,session)
 assert.equal((await normal.json()).items.length,0)
 assert.equal(statements.some(s=>s.sql?.includes('FROM goals')),false)
 const scheduled=await remindersRoute(new Request(base+'&goals=1'),db,session)
 assert.equal((await scheduled.json()).items[0].periodKey,'2026-11')
 const goalQuery=statements.find(s=>s.sql.includes('FROM goals'))
 assert.deepEqual(goalQuery.args,['family-a','member-a',date])
 assert.match(goalQuery.sql,/visibility='household' OR created_by=\?2/)
 assert.match(statements.find(s=>s.sql.includes('FROM goal_period_settlements')).sql,/household_id=\?1/)
})

test('pending retains near-due savings notices without emitting daily scheduled pushes',async()=>{
 const {db}=fixture()
 const base='https://homeflow.invalid/api/reminders?date=2026-11-28'
 const pending=await remindersRoute(new Request(base+'&pending=1'),db,session)
 const pendingItems=(await pending.json()).items
 assert.equal(pendingItems.length,1)
 assert.equal(pendingItems[0].kind,'goal')
 assert.equal(pendingItems[0].notifyToday,false)
 const scheduled=await remindersRoute(new Request(base+'&goals=1'),db,session)
 assert.deepEqual((await scheduled.json()).items,[])
})

test('after 06:00, recorded savings reminders leave pending but remain in inbox',async()=>{
 const evt=savingsReminders([monthly],'2026-11-27')[0]
 const {db}=fixture(['scheduled:'+reminderDeliveryKey(evt)])
 const r=await remindersRoute(new Request('https://homeflow.invalid/api/reminders?date=2026-11-27&pending=1'),
   db,session)
 assert.deepEqual((await r.json()).items,[])
})

test('Today savings reminders use the existing inbox read states, badges and plan navigation',()=>{
 const root=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const today=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')
 const pending=readFileSync(new URL('../src/components/ImportantReminders.vue',import.meta.url),'utf8')
 const notifications=readFileSync(new URL('../worker/notifications.js',import.meta.url),'utf8')
 const push=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.doesNotMatch(root,/goal-review-notices/)
 assert.doesNotMatch(root,/储值重要提醒/)
 assert.match(today,/savingsTarget\(item\)/)
 assert.match(today,/emit\('openPlan','goal',goal.id,goal.periodKey,false\)/)
 assert.match(today,/查看储值/)
 assert.match(today,/ref="pendingReminders"/)
 assert.match(pending,/@click="emit\('openPlan',item.kind,item.id,item.kind==='goal'\?item.periodKey\|\|'once':''\,false\)"/)
 assert.match(pending,/item.kind==='goal'\|\|item.kind==='wish'/)
 assert.match(notifications,/n.dedupe_key AS dedupeKey/)
 assert.match(push,/&goals=1/)
 assert.match(push,/const key=reminderDeliveryKey\(event\)/)
 assert.match(push,/body:event.message\|\|/)
 assert.match(notifications,/read_at IS NULL/)
})
