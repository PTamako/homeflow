import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const swipe=readFileSync(new URL('../src/components/SwipeActions.vue',import.meta.url),'utf8')

test('Plans focus deep links wait for rendering and keep row under mobile safe area',()=>{
  assert.match(life,/requestAnimationFrame\(\(\)=>\{/)
  assert.match(life,/getBoundingClientRect\(\)\.top\+window\.scrollY-176/)
  assert.match(life,/requestId!==activeFetch\|\|focusedItemId\.value!==id/)
  assert.match(life,/focusPlanFromToday/)
})

test('Plan navigation uses a single compact filter panel and hides disabled month control',()=>{
  assert.match(life,/class="plan-view-toolbar"/)
  assert.match(life,/<label v-if="planYear">月份/)
  assert.doesNotMatch(life,/<select v-model="planMonth" :disabled="!planYear"/)
  assert.ok(life.indexOf('class="life-card plan-recap"')>life.indexOf('class="life-grid"'),
    'Plan recap should follow the list, not push plan rows below the fold')
})

test('Swipe actions remain accessible through a neutral icon instead of colored rails',()=>{
  assert.match(swipe,/\.swipe-trigger\{[^}]*top:8px/)
  assert.match(swipe,/\.swipe-chevron\{display:grid/)
  assert.doesNotMatch(swipe,/swipe-stripes|stripe-edit|stripe-delete/)
  assert.match(swipe,/<button v-if="allowEdit" ref="firstAction" type="button" class="edit"/)
  assert.match(swipe,/<button v-if="allowDelete" ref="deleteAction" type="button" class="delete"/)
})

test('a historical Today deep link never duplicates a row when switching to active plans',()=>{
  const focus=life.slice(life.indexOf('async function focusExactPlan('),life.indexOf('async function finishWish('))
  const scopeGuard=focus.indexOf('if(props.focusPlanScope!==planScope.value)return')
  const apiCall=focus.indexOf('const response=await api(')
  assert.ok(scopeGuard>=0&&scopeGuard<apiCall,'scope must be checked before fetching focused record')
  assert.match(life,/const focusedItemId=computed\(\(\)=>props\.focusPlanScope===planScope\.value/)
  assert.match(focus,/kind!=='routine'\|\|planScope\.value!=='history'\|\|row\.periodOn===item\.periodOn/)
  assert.match(focus,/if\(!listed\)target\.value=uniquePlanRows\(\[item,\.\.\.target\.value\]/)
})

test('task and routine status chips always occupy the right side of the heading',()=>{
  const section=life.slice(life.indexOf('class="life-card plan-tasks-card"'),
    life.indexOf('<p v-if="!routines.length'))
  const history=section.slice(0,section.indexOf('<template v-else-if="entry.kind===\'routine\'">'))
  const activeRoutine=section.slice(section.indexOf('<template v-else-if="entry.kind===\'routine\'">'),
    section.indexOf('<div v-for="t in [entry.item]"'))
  const oneTime=section.slice(section.indexOf('<div v-for="t in [entry.item]"'))
  assert.match(history,/<div class="plan-task-head">[\s\S]*?<StatusBadge class="plan-task-status routine-state"/)
  assert.match(activeRoutine,/<div class="plan-task-head">[\s\S]*?<div class="plan-task-heading-actions">[\s\S]*?<StatusBadge v-if="r.currentPeriodOn/)
  assert.match(oneTime,/<div class="plan-task-head">[\s\S]*?<div class="plan-task-heading-actions">[\s\S]*?<StatusBadge class="plan-task-status"/)
  assert.doesNotMatch(activeRoutine.slice(activeRoutine.indexOf('<div class="plan-task-footer">')), /<StatusBadge/)
  assert.doesNotMatch(oneTime.split('<small class="once-task-summary">')[1]?.split('</small>')[0], /<StatusBadge/)
  assert.match(life,/\.plan-task-heading-actions\{[^}]*margin-left:auto/)
  assert.match(life,/\.plan-task-head>\.plan-task-status\{margin-left:auto\}/)
})
