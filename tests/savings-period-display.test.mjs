import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {savingsPeriodDisplay} from '../src/savings-period-display.mjs'

const monthly={goal_mode:'monthly',start_on:'2026-10-01',target_on:null}
const annual={goal_mode:'yearly',start_on:'2026-01-01',target_on:null}

test('monthly period shows full month even when statistics end today',()=>{
  const p=savingsPeriodDisplay(monthly,'2026-11','2026-11-05')
  assert.equal(p.start,'2026-11-01')
  assert.equal(p.end,'2026-11-30')
  assert.equal(p.status,'进行中 · 2026-12-01 起可结算')
  assert.equal(p.finished,false)
})

test('monthly target is not settled on last day, but becomes eligible next day',()=>{
  assert.equal(savingsPeriodDisplay(monthly,'2026-11','2026-11-30').finished,false)
  assert.deepEqual(savingsPeriodDisplay(monthly,'2026-11','2026-12-01').status,'已截止 · 可核验')
})

test('yearly periods and leap-year February use actual calendar ends',()=>{
  assert.equal(savingsPeriodDisplay(annual,'2026','2026-11-05').end,'2026-12-31')
  assert.equal(savingsPeriodDisplay(annual,'2026','2026-11-05').status,'进行中 · 2027-01-01 起可结算')
  assert.equal(savingsPeriodDisplay(annual,'2026','2027-01-01').finished,true)
  assert.equal(savingsPeriodDisplay({...monthly,start_on:'2024-01-01'},'2024-02','2024-02-10').end,'2024-02-29')
})

test('partial first period, not-yet-started periods, and invalid periods',()=>{
  const goal={...monthly,start_on:'2026-11-12'}
  const p=savingsPeriodDisplay(goal,'2026-11','2026-11-05')
  assert.equal(p.start,'2026-11-12')
  assert.equal(p.status,'未开始')
  assert.equal(savingsPeriodDisplay(monthly,'2026-09','2026-11-05'),null)
  assert.equal(savingsPeriodDisplay(monthly,'2026-13','2026-11-05'),null)
})

test('UI has clear period, statistics cutoff and status without redundant "not ended" copy',()=>{
 const source=readFileSync(new URL('../src/components/FinancePanel.vue',import.meta.url),'utf8')
 assert.match(source,/本期：\{\{ periodDisplay\.start \}\} ～ \{\{ periodDisplay\.end \}\}/)
 assert.match(source,/统计截至：\{\{ netLoaded\?end:'尚未读取' \}\}/)
 assert.match(source,/状态：<StatusBadge/)
  assert.match(source,/periodDisplay.status.startsWith\('进行中'\)/)
 assert.doesNotMatch(source,/本期尚未结束，暂不能确认/)
 assert.match(source,/v-if="lockedPeriod"/)
 assert.match(source,/@click="settleRecurringGoal"/)
})
