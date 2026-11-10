import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {remindersRoute} from '../worker/reminders.js'

const day='2026-11-06'
const session={household_id:'household-a',user_id:'user-a'}
const req=query=>new Request('https://homeflow.invalid/api/reminders?date='+day+query)
const tasks=[
  {id:'trash',title:'资源垃圾',due_on:day},
  {id:'other',title:'猫砂',due_on:day},
  {id:'future',title:'豆沙零食日',due_on:'2026-11-07'}
]
function fixture(deliveredKeys=[]){
  const batches=[]
  const db={
    prepare(sql){return {bind(...args){return {sql,args,async all(){return {results:[]}}}}}},
    async batch(queries){
      batches.push(queries)
      const rows=Array.from({length:11},()=>({results:[]}))
      rows[3]={results:tasks}
      rows[10]={results:[{kind:'task',item_id:'future',advance_days:1,priority:'normal'}]}
      if(queries.length===12)
        rows.push({results:deliveredKeys.map(dedupe_key=>({dedupe_key}))})
      return rows
    }
  }
  return {db,batches}
}

test('pending shows only not-yet-recorded scheduled reminders for this recipient and day',async()=>{
  const {db,batches}=fixture([
    'scheduled:task:trash:2026-11-06:0',
    'scheduled:task:future:2026-11-08:1',
    'complete:task:other:2026-11-06'
  ])
  const response=await remindersRoute(req('&pending=1'),db,session)
  assert.equal(response.status,200)
  const result=await response.json()
  assert.deepEqual(result.items.map(i=>i.id),['other','future'])
  assert.equal(batches.length,1)
  assert.equal(batches[0].length,12)
  const latest=batches[0][11]
  assert.match(latest.sql,/FROM notification_inbox/)
  assert.match(latest.sql,/recipient_user_id=\?2/)
  assert.match(latest.sql,/local_day=\?3/)
  assert.match(latest.sql,/dedupe_key LIKE 'scheduled:%'/)
  assert.doesNotMatch(latest.sql,/read_at|sent_devices/)
  assert.deepEqual(latest.args,['household-a','user-a',day])
})

test('the ordinary reminder API stays unchanged for the 06:00 scheduler',async()=>{
  const {db,batches}=fixture(['scheduled:task:trash:2026-11-06:0'])
  const response=await remindersRoute(req(''),db,session)
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).items.map(i=>i.id),['trash','other','future'])
  assert.equal(batches[0].length,11)
})

test('a recorded earlier lead reminder does not suppress another day or changed deadline',async()=>{
  const {db}=fixture([
    'scheduled:task:trash:2026-11-05:0',
    'scheduled:task:future:2026-11-07:0'
  ])
  const response=await remindersRoute(req('&pending=1'),db,session)
  assert.deepEqual((await response.json()).items.map(i=>i.id),['trash','other','future'])
})

test('Today pending tab uses the filtered route and refreshes when a push arrives',()=>{
  const pending=readFileSync(new URL('../src/components/ImportantReminders.vue',import.meta.url),'utf8')
  const today=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')
  assert.match(pending,/props\.mode==='list'\?'&pending=1':''/)
  assert.match(pending,/defineExpose\(\{refreshIfStale,refresh:load\}\)/)
  assert.match(today,/ref="pendingReminders"/)
  assert.match(today,/if\(requestedView==='pending'\)await pendingReminders\.value\?\.refresh\(\)/)
})
