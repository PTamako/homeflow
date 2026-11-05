import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const life=read('src/components/LifePanel.vue')
const swipe=read('src/components/SwipeActions.vue')
const start=life.indexOf('<div v-for="r in (planType===\'unscheduled\'?[]:routines)"',life.indexOf('<template v-else>',life.indexOf('class="plan-tasks-card"')))
const task=life.indexOf('<div v-for="t in oneTimePlans"',start)
const routineMarkup=life.slice(start,task)
const taskMarkup=life.slice(task,life.indexOf('<p v-if="!routines.length',task))

test('only one overflow trigger per task row, without clipped floating menus',()=>{
 assert.ok(start>0&&task>start)
 for(const [name,markup] of [['routine',routineMarkup],['task',taskMarkup]]){
  assert.match(markup,/:show-trigger="false"/,name+' hides the duplicate swipe ellipsis')
  assert.match(markup,/class="routine-more-trigger"/,name+' renders one visible ellipsis')
  assert.match(markup,/class="routine-inline-actions"/,name+' expands actions below swipe row')
  assert.doesNotMatch(markup,/<details class="routine-menu">/,name+' removes the floating details dropdown')
  assert.match(markup,/aria-expanded="expandedTaskMenu===/,name+' controls menu accessibility')
  assert.match(markup,/<\/SwipeActions>\s*<div v-if="expandedTaskMenu===/,name+' keeps menu outside clipped swipe container')
 }
 assert.doesNotMatch(life,/\.routine-menu-items\{position:absolute/)
 assert.match(life,/\.routine-inline-actions\{display:flex/)
 assert.match(swipe,/showTrigger\?:boolean/)
 assert.match(swipe,/showTrigger:true/)
 assert.match(swipe,/v-if="showTrigger&&!opened"/)
 assert.match(swipe,/paddingRight:showTrigger\?'30px':'0px'/)
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
