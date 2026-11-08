import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/ui-system.css',import.meta.url),'utf8')
const swipe=readFileSync(new URL('../src/components/SwipeActions.vue',import.meta.url),'utf8')

test('active task spacing is modestly condensed without losing full-height swipe rails',()=>{
  assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-content\)\{padding-block:5px\}/)
  assert.match(ui,/\.shell \.plan-tasks-card \.routine-compact\{gap:1px\}/)
  assert.match(ui,/\.shell \.plan-tasks-card \.plan-task-footer\{\s*margin-top:1px;min-height:30px/)
  assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-actions\)\{align-items:stretch;background:#fff\}/)
  assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-actions button\)\{\s*align-self:stretch;height:auto;min-height:0;flex:0 0 72px/)
  assert.match(swipe,/\.swipe-actions\{position:absolute;right:0;inset-block:0;display:flex;align-items:stretch/)
})

test('compact task rows retain status, more menu, completion and assignee details',()=>{
  const active=life.slice(life.indexOf('<template v-else-if="entry.kind===\'routine\'">'),life.indexOf('<p v-if="!routines.length'))
  assert.match(active,/class="plan-task-heading-actions"/)
  assert.match(active,/class="routine-description-row"/)
  assert.match(active,/class="routine-more-trigger"/)
  assert.match(active,/class="once-task-identity routine-meta"/)
  assert.match(active,/@click="completeCurrentRoutine\(r,'completed'\)"/)
  assert.match(active,/@click="completeOnce\(t\)"/)
})
