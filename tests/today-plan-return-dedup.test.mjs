import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const panel=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')

test('Today deep links expose only a contextual Return to Today action',()=>{
  // The standalone green banner above the filters duplicated the focused
  // plan's own return button and consumed a full row on small screens.
  assert.doesNotMatch(panel,/focused-plan-banner/)
  assert.doesNotMatch(panel,/已打开对应计划/)
  const actions=[...panel.matchAll(/<button v-if="isFocused\((\w+)\)&&props\.focusPlanFromToday" type="button" class="life-return" @click="emit\('backToToday'\)">返回今天<\/button>/g)]
  assert.equal(actions.length,7,'one action in each plan kind / routine state')
  assert.equal(actions.filter(x=>x[1]==='r').length,2,'both active and historical routine entries')
  assert.equal(actions.filter(x=>x[1]==='t').length,2,'one-time tasks and trips')
  for(const kind of ['w','g','s'])assert.equal(actions.filter(x=>x[1]===kind).length,1)
  assert.match(panel,/\.life-return\{display:block;margin:10px 0 12px/)
})

test('single return action still restores Today scroll position',()=>{
  assert.match(app,/function returnToToday\(\)/)
  assert.match(app,/window\.requestAnimationFrame\(\(\)=>window\.scrollTo\(\{top:savedTodayScrollY,behavior:'instant'\}\)\)/)
  assert.match(app,/@back-to-today="returnToToday"/)
  assert.match(panel,/isFocused=\(item:Row\)=>/)
})
