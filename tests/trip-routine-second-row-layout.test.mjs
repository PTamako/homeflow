import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const activeRoutine=life.slice(life.indexOf('<template v-else-if="entry.kind===\'routine\'">'),
  life.indexOf('<div v-for="t in [entry.item]"'))

test('active routine keeps status by heading and more menu beside description on next row',()=>{
  const heading=activeRoutine.slice(activeRoutine.indexOf('<div class="plan-task-head">'),
    activeRoutine.indexOf('<div class="routine-description-row">'))
  assert.match(heading, /class="plan-task-heading-actions">[\s\S]*?<StatusBadge v-if="r.currentPeriodOn/)
  assert.doesNotMatch(heading,/class="routine-more-trigger"/)
  const secondRow=activeRoutine.slice(activeRoutine.indexOf('<div class="routine-description-row">'),
    activeRoutine.indexOf('<small class="once-task-identity routine-meta">'))
  assert.match(secondRow, /<small class="routine-meta">[\s\S]*?<button type="button" class="routine-more-trigger"/)
  assert.match(secondRow, /@click.stop="toggleTaskMenu\('routine:'\+r.id\)"/)
  assert.match(life, /\.routine-description-row\{display:flex;align-items:center;justify-content:space-between/)
  assert.match(life, /\.routine-description-row>\.routine-more-trigger\{[^}]*margin-left:auto/)
})
