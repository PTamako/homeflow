import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=(p)=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8')
const app=src('App.vue')
const life=src('components/LifePanel.vue')
const plan=src('components/PlanCreator.vue')
const finance=src('components/FinancePanel.vue')

test('creation and one-time input controls use a bottom sheet, not expanding inline cards',()=>{
 assert.match(app,/<EditBottomSheet v-if="user.role==='owner'&&showProfileForm"/)
 assert.match(app,/<EditBottomSheet v-if="!row.done&&!row.routine&&postponeKey===row.key"/)
 assert.match(life,/<EditBottomSheet v-if="showAnniversaryForm"/)
 assert.match(life,/<EditBottomSheet v-if="showMemoryForm"/)
 assert.match(plan,/<EditBottomSheet v-if="opened" :title="step==='choose'\?'新增计划':selected\?\.label\|\|'填写计划'"/)
 assert.match(plan,/:close-disabled="busy" @close="dismiss"/)
 assert.match(life,/<EditBottomSheet v-if="planMemoryDraft\?\.kind==='wish'/)
 assert.match(life,/<EditBottomSheet v-if="planMemoryDraft\?\.kind==='trip'/)
})

test('financial details and linking screens share mobile modal patterns',()=>{
 assert.match(life,/<EditBottomSheet v-if="historicalGoalDetail\?\.goal.id===period.goalId/)
 assert.match(life,/<EditBottomSheet v-if="financeDetail\?\.kind==='goal'/)
 assert.match(life,/<EditBottomSheet v-if="\(isOwner\|\|t\.visibility==='household'\)&&financeDetail\?\.kind==='trip'/)
 assert.match(src('components/ShoppingLedgerPicker.vue'),/<EditBottomSheet title="查看关联账单"/)
 assert.match(finance,/@click="saveSettings"/)
 assert.match(finance,/@click="settleRecurringGoal"/)
})

test('settings, search, imports, filters, and item editing do not show inline native input dialogs',()=>{
 assert.match(src('components/PushPanel.vue'),/<EditBottomSheet v-if="familyFormOpen"/)
 assert.match(src('components/ManagePage.vue'),/<EditBottomSheet v-if="active&&reminderRulesOpen"/)
 assert.match(src('components/BackupPanel.vue'),/<EditBottomSheet v-if="restoreSheetOpen"/)
 assert.match(src('components/GlobalSearch.vue'),/<EditBottomSheet v-if="open"/)
 assert.match(src('components/TrashPanel.vue'),/<EditBottomSheet v-if="confirmEmpty"/)
 assert.match(src('components/ImportantReminders.vue'),/<EditBottomSheet v-if="selectedSnoozeId===item.kind/)
 assert.match(src('components/PetHealthPanel.vue'),/<EditBottomSheet v-if="historyFilterOpen"/)
 assert.match(life,/<EditBottomSheet v-if="tripImportOpen"/)
 assert.match(life,/<EditBottomSheet v-if="recapFormOpen"/)
 assert.match(life,/<EditBottomSheet v-if="tripItemEdit"/)
 assert.match(life,/<EditBottomSheet v-if="convertWishEdit"/)
 assert.doesNotMatch(life,/\bprompt\(/)
 assert.match(src('components/HouseholdPoints.vue'),/<EditBottomSheet v-if="poolContributionOpen===order.id"/)
})
