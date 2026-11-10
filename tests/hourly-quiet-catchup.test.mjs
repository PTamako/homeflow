import test from 'node:test'
import assert from 'node:assert/strict'
import {scheduledRunPhase} from '../worker/schedule-policy.js'
import {quietAtHour} from '../worker/webpush.js'
import {readFileSync} from 'node:fs'

const controller=(jstHour,cron='0 * * * *')=>({
 cron, scheduledTime:Date.UTC(2026,10,10,jstHour-9)
})

test('hourly trigger runs daily work exactly once, only from 06:00 JST',()=>{
 for(let hour=0;hour<24;hour++){
  const phase=scheduledRunPhase(controller(hour))
  assert.equal(phase,hour<6?'skip':hour===6?'daily':'catchup',String(hour))
 }
 assert.equal(scheduledRunPhase({}),'daily','legacy manual invocation remains compatible')
 assert.equal(scheduledRunPhase({cron:'0 * * * *'}),'skip','unknown fire time cannot trigger settlements')
 assert.equal(scheduledRunPhase({cron:'9 * * * *',scheduledTime:Date.now()}),'skip')
 assert.equal(scheduledRunPhase(controller(8,'0 21,23 * * *')),'catchup','in-flight old cron never re-runs settlement')
})
test('each household member can change their quiet end freely, including 10:00',()=>{
 for(const end of [6,7,8,9,10,12,15,23]){
  const quiet={start:22,end}
  assert.equal(quietAtHour(quiet,6),end>6,`end ${end}`)
  if(end>6)assert.equal(quietAtHour(quiet,end-1),true,`still quiet before ${end}`)
  assert.equal(quietAtHour(quiet,end),false,`deliver at ${end}`)
 }
 assert.equal(quietAtHour({start:22,end:10},9),true)
 assert.equal(quietAtHour({start:22,end:10},10),false)
 assert.equal(quietAtHour({start:22,end:6},10),false)
})
test('catch-up never runs the daily point settlement or notification purge',()=>{
 const worker=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8')
 assert.match(worker,/const catchUp=phase==='catchup'/)
 assert.match(worker,/catchUp\?\s*\[runPushSchedule\(env\)\]\s*:/)
 assert.match(worker,/if\(!catchUp\)try\{await purgeOldNotifications/)
 const push=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(push,/ON CONFLICT\(endpoint_hash,notification_key,sent_on\) DO UPDATE/)
 assert.match(push,/notification_deliveries.status IN \('failed','claimed'\)/)
 assert.match(push,/notification_deliveries.attempts < 3/)
 assert.match(push,/quietAtHour\(data.quietHours,hour\)/)
})
