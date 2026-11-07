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

test('lottery history uses content-height rows instead of stretched grid tracks',()=>{
  const board=rule('.points-board')
  const expanded=rule('.points-expanded')
  const history=rule('.lottery-history')
  const row=rule('.lottery-history-row')
  assert.match(board,/align-content:\s*start/)
  assert.match(expanded,/align-content:\s*start/)
  assert.match(history,/display:\s*flex/)
  assert.match(history,/flex-direction:\s*column/)
  assert.match(history,/align-self:\s*start/)
  assert.doesNotMatch(history,/display:\s*grid/)
  assert.match(row,/min-height:\s*42px/)
  assert.match(row,/padding:\s*5px 0/)
  assert.match(source,/v-for="record in lottery\.history"[^>]*class="lottery-history-row"/)
})
