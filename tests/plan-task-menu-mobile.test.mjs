import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const life=read('src/components/LifePanel.vue')
const swipe=read('src/components/SwipeActions.vue')
const start=life.indexOf('<div v-for="r in [entry.item]"',life.indexOf('<template v-else-if="entry.kind===\'routine\'">',life.indexOf('class="plan-tasks-card"')))
const task=life.indexOf('<div v-for="t in [entry.item]"',start)
const routineMarkup=life.slice(start,task)
const taskMarkup=life.slice(task,life.indexOf('<p v-if="!routines.length',task))

test('all task detail rows keep swipe edit/delete while More contains extras only',()=>{
 assert.ok(start>0&&task>start)
 for(const [name,markup] of [['routine',routineMarkup],['task',taskMarkup]]){
  assert.doesNotMatch(markup,/:show-trigger="false"/,name+' must show colored swipe rails')
  assert.match(markup,/class="routine-more-trigger"/,name+' retains contextual More')
  assert.match(markup,/class="routine-inline-actions"/,name+' expands extra actions beneath row')
  assert.doesNotMatch(markup,/<details class="routine-menu">/)
  assert.match(markup,/<\/SwipeActions>\s*<div v-if="expandedTaskMenu===/)
 }
 const routineExtras=routineMarkup.split('class="routine-inline-actions"')[1]?.split('</div>')[0]||''
 const taskExtras=taskMarkup.split('class="routine-inline-actions"')[1]?.split('</div>')[0]||''
 assert.ok(routineExtras.includes('提醒设置')&&routineExtras.includes('跳过本期'))
 assert.ok(taskExtras.includes('提醒设置'))
 for(const extras of [routineExtras,taskExtras]){
  assert.ok(!extras.includes('>编辑</button>'))
  assert.ok(!extras.includes('>删除</button>'))
 }
 assert.match(taskMarkup,/v-if="planScope==='active'&&\(!!t\.dueOn\|\|/)
 assert.match(taskExtras,/通知处理人/)
 assert.match(swipe,/showTrigger\?:boolean/)
 assert.match(swipe,/showTrigger:true/)
 assert.doesNotMatch(swipe,/swipe-stripes|stripe-edit|stripe-delete/)
 assert.match(swipe,/\.swipe-actions \.edit\{background:#558bc9\}/)
 assert.match(swipe,/\.swipe-actions \.delete\{background:#d76178\}/)
 assert.match(swipe,/class="swipe-chevron"/)
 assert.match(swipe,/showTriggerUi=computed/)
 assert.doesNotMatch(swipe,/<AppIcon name="ellipsis"/)
 assert.match(swipe,/v-if="showTriggerUi&&!opened"/)
})
test('all actions remain reachable: reminders, skip, edit, delete and completion',()=>{
 assert.match(routineMarkup,/toggleReminderEditor\('routine',r\.id\)/)
 assert.match(routineMarkup,/completeCurrentRoutine\(r,'skipped'\)/)
 assert.match(routineMarkup,/completeCurrentRoutine\(r,'completed'\)/)
 assert.match(routineMarkup,/completeRoutineEarly\(r\)/)
 assert.match(routineMarkup,/edit\('routines',r\)/)
 assert.match(routineMarkup,/removeItem\('routines',r\)/)
 assert.match(taskMarkup,/toggleReminderEditor\('task',t\.id\)/)
 assert.match(taskMarkup,/editOnce\(t\)/)
 assert.match(taskMarkup,/deleteOnce\(t\)/)
 assert.match(taskMarkup,/completeOnce\(t\)/)
 assert.ok(swipe.includes("props.scope+':'+props.id"))
 assert.match(swipe,/@touchstart\.passive="start"/)
})
