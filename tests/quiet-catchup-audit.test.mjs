import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {saveNotification} from '../worker/notifications.js'
import {quietAtHour} from '../worker/webpush.js'
import {POINTS_AUDIT_SOURCES} from '../worker/portable.js'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('06:00 and 08:00 respect both members quiet-hour preferences',()=>{
 assert.equal(quietAtHour({start:22,end:6},6),false)
 assert.equal(quietAtHour({start:22,end:6},8),false)
 assert.equal(quietAtHour({start:22,end:8},6),true)
 assert.equal(quietAtHour({start:22,end:8},8),false)
 assert.match(read('worker/index.js'),/controller\?\.cron==='0 23 \* \* \*'/)
 assert.match(read('worker/index.js'),/catchUp\?\s*\[runPushSchedule\(env\)\]/)
 assert.match(read('src/components/ImportantReminders.vue'),/08:00 补发/)
})

test('new delivery states preserve existing inbox read/dedupe and correctly record quiet hours',async()=>{
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=OFF')
 sqlite.exec(read('migrations/0025_daily_notification_inbox.sql'))
 sqlite.exec(read('migrations/0031_completion_event_read_state.sql'))
 sqlite.exec(`INSERT INTO notification_inbox
   (id,household_id,recipient_user_id,kind,title,message,delivery_status,local_day,read_at,dedupe_key,last_completion_key)
   VALUES('legacy','house','member','routine','任务','请处理','failed','2026-11-10','2026-11-10T01:00:00Z','dedupe','revision-1')`)
 sqlite.exec(read('migrations/0050_notification_delivery_state.sql'))
 const row=sqlite.prepare("SELECT * FROM notification_inbox WHERE id='legacy'").get()
 assert.equal(row.delivery_status,'app_only')
 assert.equal(row.read_at,'2026-11-10T01:00:00Z')
 assert.equal(row.dedupe_key,'dedupe')
 assert.equal(row.last_completion_key,'revision-1')
 const db={prepare(sql){return {bind(...args){return {run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}})}}}}}
 const base={id:'new',householdId:'house',recipientId:'member',kind:'routine',sourceId:'task',
   title:'洗衣',message:'今日提醒',localDay:'2026-11-10',dedupeKey:'another',
   sentDevices:0,failedDevices:0}
 await saveNotification(db,{...base,deliveryReason:'quiet'})
 assert.equal(sqlite.prepare("SELECT delivery_status FROM notification_inbox WHERE id='new'").get().delivery_status,'quiet')
 await saveNotification(db,{...base,deliveryReason:'app_only'})
 assert.equal(sqlite.prepare("SELECT delivery_status FROM notification_inbox WHERE id='new'").get().delivery_status,'app_only')
 await saveNotification(db,{...base,sentDevices:2,failedDevices:0})
 assert.equal(sqlite.prepare("SELECT delivery_status FROM notification_inbox WHERE id='new'").get().delivery_status,'sent')
 await saveNotification(db,{...base,deliveryReason:'quiet'})
 assert.equal(sqlite.prepare("SELECT delivery_status FROM notification_inbox WHERE id='new'").get().delivery_status,'sent')
 const partial={...base,id:'partial',dedupeKey:'partial',sentDevices:1,failedDevices:1}
 await saveNotification(db,partial)
 await saveNotification(db,{...partial,sentDevices:0,failedDevices:0,deliveryReason:'app_only'})
 const preserved=sqlite.prepare("SELECT delivery_status,failed_devices FROM notification_inbox WHERE id='partial'").get()
 assert.equal(preserved.delivery_status,'partial')
 assert.equal(preserved.failed_devices,1)
 sqlite.close()
})
test('private coupon and discounts are exported in audit-only ZIP, not replayed as awards',()=>{
 const coupons=POINTS_AUDIT_SOURCES.find(x=>x[0]==='lotteryCoupons')
 const discounts=POINTS_AUDIT_SOURCES.find(x=>x[0]==='rewardCouponDiscounts')
 assert.equal(coupons?.[1],'lottery_coupons')
 assert.equal(discounts?.[1],'reward_coupon_discounts')
 assert.equal(coupons?.[2],'household_id=?1 AND user_id=?2')
 assert.equal(discounts?.[2],'household_id=?1 AND user_id=?2')
 assert.match(read('src/components/BackupPanel.vue'),/'lotteryCoupons','rewardCouponDiscounts'/)
 const portable=read('worker/portable.js')
 assert.doesNotMatch(portable.split('const queries=[')[1].split('const exportMax')[0],/lotteryCoupons|rewardCouponDiscounts/)
})
