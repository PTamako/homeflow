import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('history period detail opens inline and never goes through Today navigation',()=>{
 const life=src('src/components/LifePanel.vue')
 assert.match(life,/async function toggleHistoricalGoalPeriod\(period:GoalPeriodArchive\)/)
 assert.match(life,/@click="toggleHistoricalGoalPeriod\(period\)"/)
 assert.doesNotMatch(life,/@click="emit\('openPlans','goal',period\.goalId,period\.periodKey\)"/)
 assert.match(life,/:initial-period-key="period\.periodKey"/)
 assert.match(life,/:goals="\[historicalGoalDetail\.goal\]"/)
 assert.match(life,/historicalGoalDetail\?\.periodKey===period\.periodKey"/)
 assert.match(life,/v-if="historicalGoalDetail\?\.goal\.id===period\.goalId/)
 assert.match(life,/if\(kind==='goal'&&planScope\.value==='history'&&/)
 assert.match(life,/\['monthly','yearly'\]\.includes\(item\.goal_mode\)\)return/)
})

test('return-to-Today is only visible for actual navigations originating in Today',()=>{
 const app=src('src/App.vue')
 const life=src('src/components/LifePanel.vue')
 assert.match(app,/focusPlanFromToday\.value=tab\.value==='today'&&!!id/)
 assert.match(app,/:focus-plan-from-today="focusPlanFromToday"/)
 assert.match(life,/v-if="focusedItemId&&props\.focusPlanFromToday" class="focused-plan-banner"/)
 assert.match(life,/v-if="isFocused\(g\)&&props\.focusPlanFromToday"/)
 assert.match(life,/v-if="isFocused\(w\)&&props\.focusPlanFromToday"/)
 assert.match(life,/v-if="isFocused\(s\)&&props\.focusPlanFromToday"/)
 assert.match(life,/v-if="isFocused\(t\)&&props\.focusPlanFromToday"/)
})

test('opening an archived month preserves scope and can recheck via the original detail editor',()=>{
 const life=src('src/components/LifePanel.vue')
 const finance=src('src/components/FinancePanel.vue')
 assert.match(life,/planScope\.value!=='history'/)
 assert.match(life,/@completed="goalFinished"/)
 assert.match(life,/historicalGoalDetailRequest\+\+/)
 assert.match(finance,/async function settleRecurringGoal\(/)
 assert.match(finance,/\/periods\/settle/)
 assert.match(finance,/props\.initialPeriodKey\|\|defaultPeriodKey\(\)/)
})
