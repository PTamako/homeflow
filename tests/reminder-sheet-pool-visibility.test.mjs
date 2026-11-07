import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('reminder rule sheet has no redundant line or spacer under its bottom-sheet header',()=>{
 const manage=src('src/components/ManagePage.vue')
 const reminders=src('src/components/ImportantReminders.vue')
 assert.match(manage,/<EditBottomSheet v-if="active&&reminderRulesOpen" title="分类提醒规则"/)
 assert.match(reminders,/:class="\['reminder-settings',\{'reminder-settings--sheet':mode==='settings'\}\]"/)
 assert.match(reminders,/\.reminder-settings--sheet\{margin-top:0;border-top:0\}/)
 assert.match(reminders,/\.reminder-settings--sheet>\.reminder-rule-section:first-child\{padding-top:0\}/)
})

test('cancelled and refunded joint redemptions are excluded at the API and UI, not deleted from history',()=>{
 const api=src('worker/rewards.js')
 const ui=src('src/components/HouseholdPoints.vue')
 assert.match(api,/FROM reward_group_orders o WHERE o.household_id=\?1\s+AND o.status<>'cancelled'/)
 assert.match(api,/SELECT id FROM reward_group_orders WHERE household_id=\?1\s+AND status<>'cancelled'/)
 assert.match(ui,/filter\(order=>order.status!=='cancelled'\)/)
 assert.match(api,/SET status='cancelled',cancelled_at=/)
 assert.doesNotMatch(api,/DELETE FROM reward_group_orders/)
})
