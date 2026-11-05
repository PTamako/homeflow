import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('archived savings period is read-only and bound to the opened month or year',()=>{
  const finance=src('src/components/FinancePanel.vue')
  const life=src('src/components/LifePanel.vue')
  assert.match(life,/:fixed-period-key="period\.periodKey"/)
  assert.match(life,/:initial-period-key="period\.periodKey"/)
  assert.match(finance,/fixedPeriodKey\?:string/)
  assert.match(finance,/const lockedPeriod=computed\(\(\)=>recurringGoal\.value&&!!props\.fixedPeriodKey\)/)
  assert.match(finance,/periodKey\.value=props\.fixedPeriodKey\|\|props\.initialPeriodKey\|\|defaultPeriodKey\(\)/)
  assert.match(finance,/if\(lockedPeriod\.value&&periodKey\.value!==props\.fixedPeriodKey\)/)
  assert.match(finance,/<div v-if="lockedPeriod" class="locked-period">/)
  assert.match(finance,/<strong>\{\{ goalMode==='monthly'\?periodKey\.replace\('-','年'\)\+'月':periodKey\+'年' \}\}<\/strong>/)
  assert.match(finance,/<label v-else-if="goalMode==='monthly'">选择月份/)
  assert.match(finance,/<label v-else>选择年份/)
})

test('ongoing savings keeps period selection and archive stays in History without extra ledger reads',()=>{
  const life=src('src/components/LifePanel.vue')
  const finance=src('src/components/FinancePanel.vue')
  const occurrences=(life.match(/:fixed-period-key=/g)||[]).length
  assert.equal(occurrences,1)
  assert.match(life,/\:initial-period-key="isFocused\(g\)\?props\.focusPlanPeriodKey\|\|''\:''"/)
  assert.match(finance,/async function settleRecurringGoal\(/)
  assert.match(finance,/\/periods\/settle/)
  assert.match(life,/historicalGoalPeriods/)
})
