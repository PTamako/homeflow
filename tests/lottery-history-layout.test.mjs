import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const rule=selector=>{
  const escaped=selector.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&')
  const match=source.match(new RegExp(escaped+'\\s*\\{([^}]*)\\}'))
  assert.ok(match,'Missing CSS rule '+selector)
  return match[1]
}

test('lottery history rows keep their own content height without stretching the first result',()=>{
  const board=rule('.points-board')
  const expanded=rule('.points-expanded')
  const history=rule('.lottery-history')
  const list=rule('.lottery-history-list')
  const row=rule('.lottery-history-row')
  const detail=rule('.lottery-history-detail')
  assert.match(board,/align-content:\\s*start/)
  assert.match(expanded,/align-content:\\s*start/)
  assert.match(history,/display:\\s*block/)
  assert.match(history,/align-self:\\s*start/)
  assert.match(list,/display:\\s*block/)
  assert.match(list,/margin:\\s*4px 0 0/)
  assert.match(row,/display:\\s*flex/)
  assert.doesNotMatch(row,/display:\\s*grid/)
  assert.match(row,/min-height:\\s*42px/)
  assert.match(row,/padding:\\s*5px 0/)
  assert.match(detail,/flex:\\s*1 1 auto/)
  assert.match(source,/<ul v-else class="lottery-history-list">/)
  assert.match(source,/<li v-for="record in lottery\\.history"[^>]*class="lottery-history-row">/)
  assert.match(source,/<\\/li>\\s*<\\/ul>/)
})
