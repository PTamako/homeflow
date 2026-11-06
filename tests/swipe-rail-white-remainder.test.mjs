import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=name=>readFileSync(new URL('../src/components/'+name+'.vue',import.meta.url),'utf8')
const swipe=read('SwipeActions')
const life=read('LifePanel')

test('the shared swipe rail has a white remainder beneath compact actions',()=>{
 assert.match(swipe,/\.swipe-actions\{[^}]*background:#fff/)
 assert.match(swipe,/\.swipe-actions \.edit\{background:#558bc9\}/)
 assert.match(swipe,/\.swipe-actions \.delete\{background:#d76178\}/)
 assert.match(swipe,/\.swipe-row\.is-open \.swipe-actions/)
})

test('both recurring plans and timeline override rail colors consistently',()=>{
 for(const selector of ['plan-task-item','memory']){
  const escaped=selector.replaceAll('-','\\-')
  assert.match(life,new RegExp('\\.'+escaped+' :deep\\(\\.swipe-actions\\)\\{align-items:flex-start;background:#fff\\}'))
  assert.doesNotMatch(life,new RegExp('\\.'+escaped+' :deep\\(\\.swipe-actions\\)\\{align-items:flex-start;background:#f4f7f4\\}'))
 }
 assert.match(life,/\.plan-task-item :deep\(\.swipe-actions button\)\{height:min\(72px,100%\);flex:0 0 72px\}/)
 assert.match(life,/\.memory :deep\(\.swipe-actions button\)\{height:72px;flex:0 0 72px\}/)
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
