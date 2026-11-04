import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('savings details no longer duplicate period settlement history or issue archive queries',()=>{
  const finance=read('src/components/FinancePanel.vue')
  assert.doesNotMatch(finance,/每期结算历史|settlement-history|settlementRows|loadSettlementHistory/)
  assert.doesNotMatch(finance,/\/goals\/.*\/periods\?/)
  assert.doesNotMatch(finance,/historyYear|historyMonth|settlementCursor|settlementLoading/)
  assert.match(finance,/async function settleRecurringGoal\(/)
  assert.match(finance,/\/periods\/settle/)
  assert.match(finance,/initialPeriodKey/)
  assert.match(finance,/保存.*调整额/)
})

test('canonical Plans history and backend settlement records remain available',()=>{
  const life=read('src/components/LifePanel.vue')
  const archive=read('worker/goal-period-archive.js')
  const index=read('worker/index.js')
  const backup=read('worker/portable.js')
  assert.match(life,/historicalGoalPeriods/)
  assert.match(life,/已完成／历史/)
  assert.match(life,/查看本期/)
  assert.match(life,/historicalGoalPath/)
  assert.match(archive,/goal_period_settlements/)
  assert.match(index,/goalPeriodArchiveRoute/)
  assert.match(backup,/goalPeriodSettlements/)
})
