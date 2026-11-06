import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const life=read('src/components/LifePanel.vue')
const swipe=read('src/components/SwipeActions.vue')
const start=life.indexOf('class="life-card plan-tasks-card"')
const finish=life.indexOf("<p v-if=\"!routines.length",start)
const tasks=life.slice(start,finish)

test('all plan task swipe surfaces are opaque so action rails cannot show behind task text',()=>{
 assert.match(life,/\.plan-task-item :deep\(\.swipe-content\)\{background:#fff\}/)
 assert.match(life,/\.plan-tasks-card \.plan-task-item\.focused-plan-entry :deep\(\.swipe-content\)\{background:#f7fbf8\}/)
 assert.doesNotMatch(life,/\.plan-task-item :deep\(\.swipe-content\)\{background:transparent\}/)
 assert.doesNotMatch(life,/\.plan-tasks-card \.plan-task-item\.focused-plan-entry :deep\(\.swipe-content\)\{background:transparent\}/)
 assert.match(life,/\.plan-task-item \.routine-compact\{width:100%;min-width:0;overflow-wrap:anywhere\}/)
})

test('recurring and one-off task edit/delete rails stay top-aligned and short on tall rows',()=>{
 assert.match(life,/\.plan-task-item :deep\(\.swipe-actions\)\{align-items:flex-start;background:#f4f7f4\}/)
 assert.match(life,/\.plan-task-item :deep\(\.swipe-actions button\)\{height:min\(72px,100%\);flex:0 0 72px\}/)
 assert.match(swipe,/\.swipe-actions\{[\s\S]*?visibility:hidden/)
 assert.match(swipe,/\.swipe-actions \.edit\{background:#558bc9\}/)
 assert.match(swipe,/\.swipe-actions \.delete\{background:#d76178\}/)
 assert.match(swipe,/touch-action:pan-y/)
 assert.match(tasks,/scope="routines"/)
 assert.match(tasks,/scope="one-time-plans"/)
 assert.match(tasks,/class="plan-task-footer"/)
 assert.match(tasks,/class="routine-more-trigger"/)
})

test('opening Edit/Delete on a list entry closes contextual More, without losing real action handlers',()=>{
 assert.match(swipe,/defineEmits<\{open:\[\];edit:\[\];delete:\[\]\}>/)
 assert.match(swipe,/activeSwipeId\.value=key\.value\s*\/\/ A contextual More menu must close/)
 assert.match(swipe,/emit\('open'\)/)
 for(const scope of ['routines','one-time-plans','shopping','wishes','trips']){
  const i=life.indexOf('scope="'+scope+'"')
  assert.ok(i>0,scope)
  const tag=life.slice(i,life.indexOf('>',i))
  assert.match(tag,/@open="expandedTaskMenu=null"/,scope)
  assert.match(tag,/@edit=/,scope)
  assert.match(tag,/@delete=/,scope)
 }
 assert.match(life,/expandedTaskMenu\.value=null/)
})
