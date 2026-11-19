import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {kakeiboBillReminderEvents,projectKakeiboBillReminderEvents,shouldCheckKakeiboBillsAtHour} from '../worker/kakeibo-bill-reminders.js'
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222'
const member={user_id:A,household_id:'household-1'}
const F='33333333-3333-4333-8333-333333333333'
const V='44444444-4444-4444-8444-444444444444'
const payload={recipientId:A,householdId:'household-1',items:[
 {kind:'fixed',planId:F,name:'家賃',dueOn:'2026-11-27',amountJpy:101500},
 {kind:'variable',planId:V,name:'オクトパスエナジー',dueOn:'2026-11-26',periodMonth:'2026-10',amountJpy:1987}
]}
test('fixed is previous day and variable is posting day, with stable dedupe keys',()=>{
 const events=projectKakeiboBillReminderEvents(payload,member,'2026-11-26')
 assert.equal(events.length,2)
 assert.equal(events[0].daysBefore,1)
 assert.equal(events[0].dueOn,'2026-11-27')
 assert.equal(events[1].daysBefore,0)
 assert.equal(events[1].dueOn,'2026-11-26')
 assert.deepEqual(events.map(e=>e.kind),['system','system'])
 assert.equal(new Set(events.map(e=>e.id)).size,2)
 assert.deepEqual(projectKakeiboBillReminderEvents(payload,member,'2026-11-25'),[])
})
test('owner and household proof must both match before displaying any financial data',()=>{
 assert.deepEqual(projectKakeiboBillReminderEvents(payload,{user_id:B,household_id:member.household_id},'2026-11-26'),[])
 assert.deepEqual(projectKakeiboBillReminderEvents(payload,{user_id:A,household_id:'other'},'2026-11-26'),[])
})
test('bridge only reads through the private Service Binding, on fail closed returns none',async()=>{
 const env={KAKEBO_LEDGER_SERVICE:{fetch:async request=>{
  const u=new URL(request.url)
  assert.equal(u.searchParams.get('recipientUserId'),A)
  assert.equal(u.searchParams.get('householdId'),'household-1')
  return Response.json(payload)
 }}}
 assert.equal((await kakeiboBillReminderEvents(env,member,'2026-11-26')).length,2)
 assert.deepEqual(await kakeiboBillReminderEvents({},member,'2026-11-26'),[])
 assert.deepEqual(await kakeiboBillReminderEvents({KAKEBO_LEDGER_SERVICE:{fetch:async()=>Response.json(payload,{status:503})}},member,'2026-11-26'),[])
})
test('one existing daily inbox and Push pipeline serves bill reminders',()=>{
 const code=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(code,/kakeiboBillReminderEvents\(env,member,day\)/)
 assert.match(code,/\.\.\.billEvents/)
 assert.match(code,/ensureScheduledNotification\(db,notice\)/)
 assert.match(code,/INSERT INTO notification_deliveries/)
})

test('bill checks happen at 06:00 JST and every two hours through 22:00 only',()=>{
 const allowed=[6,8,10,12,14,16,18,20,22]
 const actual=Array.from({length:24},(_,hour)=>hour).filter(shouldCheckKakeiboBillsAtHour)
 assert.deepEqual(actual,allowed)
 for(const invalid of [NaN,undefined,-1,6.5,24,'6',null])
  assert.equal(shouldCheckKakeiboBillsAtHour(invalid),false)
})
test('bill checks and shared Today reminders use the same two-hour Cron; wallet alerts remain enabled',()=>{
 const code=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(code,/const billEvents=shouldCheckKakeiboBillsAtHour\(hour\)/)
 assert.match(code,/\?await kakeiboBillReminderEvents\(env,member,day\):\[\]/)
 assert.match(code,/const walletEvents=await loadPrepaidOwnerAlertEvents\(env,member,day\)/)
 assert.match(code,/const response=await remindersRoute\(/)
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
 assert.match(config,/crons = \["0 1-23\/2 \* \* \*"\]/)
})
