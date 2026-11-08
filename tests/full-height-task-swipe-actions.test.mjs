import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const swipe=readFileSync(new URL('../src/components/SwipeActions.vue',import.meta.url),'utf8')
const active=life.slice(life.indexOf('<template v-else-if="entry.kind===\'routine\'">'),
  life.indexOf('<p v-if="!routines.length'))

test('both current routines and one-time tasks expose full-height swipe surfaces',()=>{
  const items=[...active.matchAll(/class="plan-task-item" data-swipe-item/g)]
  assert.equal(items.length,2,'only the two active task types receive full height rails')
  assert.match(life,/\.plan-tasks-card \.plan-task-item\[data-swipe-item\]\{padding-block:0\}/)
  assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-content\)\{padding-block:8px\}/)
  assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-actions\)\{align-items:stretch/)
  assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-actions button\)\{\s*align-self:stretch;height:auto;min-height:0;flex:0 0 72px/)
  assert.doesNotMatch(life,/\.plan-task-item :deep\(\.swipe-actions button\)\{height:min\(72px,100%\)/)
})

test('swipe rails remain inside full row, behind opaque moving content',()=>{
  assert.match(swipe,/\.swipe-actions\{position:absolute;right:0;inset-block:0;display:flex;align-items:stretch/)
  assert.match(swipe,/\.swipe-content\{position:relative;z-index:1;background:#fff/)
  assert.match(swipe,/\.swipe-row\.is-open \.swipe-actions,\.swipe-row\.is-dragging \.swipe-actions\{visibility:visible\}/)
  assert.match(swipe,/@click.stop="run\('edit'\)"/)
  assert.match(swipe,/@click.stop="run\('delete'\)"/)
})

test('historical rows and other swipe lists are unchanged',()=>{
  const history=life.slice(life.indexOf("<template v-if=\"entry.kind==='routine'&&planScope==='history'\">"),
    life.indexOf("<template v-else-if=\"entry.kind==='routine'\">"))
  assert.doesNotMatch(history, /data-swipe-item/)
  assert.doesNotMatch(life,/\.plan-task-item :deep\(\.swipe-actions\)\{align-items:flex-start/)
})
