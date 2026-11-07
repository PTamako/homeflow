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

test('lottery history rows use a standalone list so the first entry cannot stretch',()=>{
  const board=rule('.points-board')
  const expanded=rule('.points-expanded')
  const history=rule('.lottery-history')
  const list=rule('.lottery-history-list')
  const row=rule('.lottery-history-row')
  const detail=rule('.lottery-history-detail')
  assert.ok(board.includes('align-content:start'))
  assert.ok(expanded.includes('align-content:start'))
  assert.ok(history.includes('display:block'))
  assert.ok(history.includes('align-self:start'))
  assert.ok(list.includes('display:block'))
  assert.ok(list.includes('margin:4px 0 0'))
  assert.ok(row.includes('display:flex'))
  assert.ok(!row.includes('display:grid'))
  assert.ok(row.includes('min-height:42px'))
  assert.ok(row.includes('padding:5px 0'))
  assert.ok(detail.includes('flex:1 1 auto'))
  assert.ok(source.includes('<ul v-else class="lottery-history-list">'))
  assert.ok(source.includes('<li v-for="record in lottery.history"'))
  assert.ok(source.includes('class="lottery-history-row"'))
  assert.ok(source.includes('</li>'))
  assert.ok(source.includes('</ul>'))
})
