import test from 'node:test'
import assert from 'node:assert/strict'
import {verifiedDatabase} from '../worker/security.js'

const extra={finance_migrations_ready:8,recent_migrations_ready:5,prepaid_alert_migrations_ready:2,
 reminder_columns_ready:2,reminder_guard_triggers_ready:3,
 finance_tables_ready:15,finance_indexes_ready:8,finance_triggers_ready:8,
 coupon_tables_ready:2,coupon_triggers_ready:5,travel_triggers_ready:2,
 monthly_triggers_ready:5,savings_triggers_ready:4,points_triggers_ready:10,
 rewards_tables_ready:5,rewards_triggers_ready:4}
function dbFor(overrides={}){
 const rows={database_name:'homeflow',baseline_ready:1,...extra,...overrides}
 const statements=[]
 const db={prepare(sql){statements.push(sql);return {first:async()=>new Proxy(rows,{
  get(target,key){return key in target?target[key]:1}
 })}}}
 return {db,statements}
}
test('quick preflight requires ALL 0061–0065 production migrations',async()=>{
 const live=dbFor()
 assert.equal(await verifiedDatabase({APP_ENV:'production',DB:live.db},{quick:true}),true)
 for(const migration of ['0061_hidden_deleted_shared_approval_history.sql',
   '0062_dismissed_applied_approval_history.sql',
   '0063_expand_applied_ledger_approval_dismissal.sql',
   '0064_reminder_only_no_points.sql',
   '0065_extend_active_sessions_to_30_days.sql'])
   assert.ok(live.statements[0].includes(migration),migration)
 const missing=dbFor({recent_migrations_ready:4})
 assert.equal(await verifiedDatabase({APP_ENV:'production',DB:missing.db},{quick:true}),false)
})
test('health check fails closed on missing reminder-only columns or scoring guards',async()=>{
 const live=dbFor()
 assert.equal(await verifiedDatabase({APP_ENV:'production',DB:live.db}),true)
 assert.ok(live.statements[0].includes("pragma_table_info('tasks')"))
 assert.ok(live.statements[0].includes("instr(sql,'reminder_only')"))
 for(const missingField of ['recent_migrations_ready','reminder_columns_ready','reminder_guard_triggers_ready']){
  const broken=dbFor({[missingField]:0})
  assert.equal(await verifiedDatabase({APP_ENV:'production',DB:broken.db}),false,missingField)
 }
})
