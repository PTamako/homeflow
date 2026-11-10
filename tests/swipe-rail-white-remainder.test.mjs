import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=name=>readFileSync(new URL('../src/components/'+name+'.vue',import.meta.url),'utf8')
const swipe=read('SwipeActions')
const life=read('LifePanel')

test('the shared swipe rail hides its white background behind full-height colored actions',()=>{
 assert.match(swipe,/\.swipe-actions\{[^}]*background:#fff/)
 assert.match(swipe,/\.swipe-actions \.edit\{background:#558bc9\}/)
 assert.match(swipe,/\.swipe-actions \.delete\{background:#d76178\}/)
 assert.match(swipe,/\.swipe-row\.is-open \.swipe-actions/)
})

test('task and timeline action buttons both stretch to the full row',()=>{
 assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-actions\)\{align-items:stretch;background:#fff\}/)
 assert.match(life,/\.plan-task-item\[data-swipe-item\] :deep\(\.swipe-actions button\)\{\s*align-self:stretch;height:auto;min-height:0;flex:0 0 72px/)
 assert.doesNotMatch(life,/\.plan-task-item :deep\(\.swipe-actions\)\{align-items:flex-start/)
 assert.match(life,/\.memory :deep\(\.swipe-actions\)\{align-items:stretch;background:#fff\}/)
 assert.match(life,/\.memory :deep\(\.swipe-actions button\)\{align-self:stretch;height:auto;min-height:0;flex:0 0 72px\}/)
})

test('the task body stays opaque and timeline stays one swipe surface',()=>{
 assert.match(life,/\.plan-task-item :deep\(\.swipe-content\)\{background:#fff\}/)
 assert.match(life,/\.memory :deep\(\.swipe-content\)\{background:#fff\}/)
 const start=life.indexOf('<article v-for="m in listLoading?[]:items"')
 const end=life.indexOf('</article>',start)
 const memory=life.slice(start,end)
 assert.ok(memory.indexOf('<SwipeActions')>=0)
 assert.ok(memory.indexOf('</SwipeActions>')>memory.indexOf('<p>{{ m.story }}</p>'))
})
