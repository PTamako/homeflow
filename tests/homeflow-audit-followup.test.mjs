import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const finance=read('src/components/FinancePanel.vue')
const life=read('src/components/LifePanel.vue')
const push=read('worker/webpush.js')
const r2=read('worker/media.js')

test('savings UI distinguishes estimated net cash flow from actual verified deposits',()=>{
 assert.match(finance,/家庭收支净额（估算）/)
 assert.match(finance,/储值进度估算/)
 assert.match(finance,/估算完成率/)
 assert.match(finance,/已确认实际存款：未核验/)
 assert.match(finance,/自动结算与积分按此估算口径计算/)
 assert.match(finance,/message:'HomeFlow 仅根据家計簿家庭收支净额/)
 assert.match(finance,/message:'结算依据是家計簿家庭收支净额/)
 assert.match(finance,/if\(!wasCompleted&&!await confirmAction\(/)
 assert.match(finance,/if\(!await confirmAction\(/)
 assert.match(finance,/<ConfirmActionSheet v-if="confirmRequest"/)
 assert.match(life,/收支估算 ¥/)
 assert.match(life,/估算达标/)
})

test('hourly notifications skip registered rows and recount all persisted device states',()=>{
 assert.match(push,/alreadyRegistered\.set\(member\.user_id,await existingScheduledDedupeKeys/)
 assert.match(push,/if\(alreadyRegistered\.get\(notice\.recipientId\)\?\.has\(notice\.dedupeKey\)\)continue/)
 assert.match(push,/const totals=await scheduledDeliveryTotals\(db,/)
 assert.match(push,/FROM push_subscriptions s JOIN notification_deliveries d/)
 assert.match(push,/d\.status='sent'/)
})

test('image activation rechecks the currently live and readable parent memory',()=>{
 const active=r2.split('const activated=await db.prepare')[1]?.split('.bind(id,h,u).run()')[0]
 assert.ok(active,'upload must have an activation statement')
 assert.match(active,/m\.id=media_assets\.memory_id/)
 assert.match(active,/m\.deleted_at IS NULL/)
 assert.match(active,/m\.visibility='household' OR m\.created_by=\?3/)
})
