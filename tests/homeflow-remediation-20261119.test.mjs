import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {scheduledRunPhase} from '../worker/schedule-policy.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('nine effective Cron times are exactly 06:00 to 22:00 JST',()=>{
 assert.match(read('wrangler.toml'),/0 1-13\/2,21,23 \* \* \*/)
 const hours=[1,3,5,7,9,11,13,21,23]
 assert.deepEqual(hours.map(x=>(x+9)%24).sort((a,b)=>a-b),[6,8,10,12,14,16,18,20,22])
 for(const hour of hours){
  const phase=scheduledRunPhase({cron:'0 1-13/2,21,23 * * *',scheduledTime:Date.UTC(2026,10,19,hour)})
  assert.equal(phase,(hour+9)%24===6?'daily':'catchup')
 }
})
test('database identity gate needs both prepaid migrations in quick and full modes',()=>{
 const s=read('worker/security.js')
 assert.match(s,/0066_prepaid_owner_alert_observations\.sql/)
 assert.match(s,/0067_prepaid_upper_alert_observations\.sql/)
 assert.equal((s.match(/Number\(identity\.prepaid_alert_migrations_ready\)===2/g)||[]).length,2)
})
test('failed private bill reads leave privacy-safe diagnostics',()=>{
 const s=read('worker/kakeibo-bill-reminders.js')
 assert.match(s,/homeflow_bill_confirmation_projection_unavailable/)
 assert.match(s,/homeflow_bill_confirmation_scope_invalid/)
})
test('reminder-only rows never display task status badges',()=>{
 const s=read('src/App.vue')
 assert.match(s,/v-if="row\.task&&!isReminderOnlyToday\(row\)"/)
 assert.match(s,/v-if="!isReminderOnlyToday\(row\)"/)
})
