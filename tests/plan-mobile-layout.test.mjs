import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const swipe=readFileSync(new URL('../src/components/SwipeActions.vue',import.meta.url),'utf8')

test('Plans focus deep links wait for rendering and keep row under mobile safe area',()=>{
  assert.match(life,/requestAnimationFrame\(\(\)=>\{/)
  assert.match(life,/getBoundingClientRect\(\)\.top\+window\.scrollY-176/)
  assert.match(life,/requestId!==activeFetch\|\|props\.focusPlanId!==id/)
  assert.match(life,/focusPlanFromToday/)
})

test('Plan navigation uses a single compact filter panel and hides disabled month control',()=>{
  assert.match(life,/class="plan-view-toolbar"/)
  assert.match(life,/<label v-if="planYear">月份/)
  assert.doesNotMatch(life,/<select v-model="planMonth" :disabled="!planYear"/)
  assert.ok(life.indexOf('class="life-card plan-recap"')>life.indexOf('class="life-grid"'),
    'Plan recap should follow the list, not push plan rows below the fold')
})

test('Swipe edit/delete cues remain available but are compact and header-aligned',()=>{
  assert.match(swipe,/\.swipe-trigger\{[^}]*top:8px/)
  assert.match(swipe,/\.swipe-stripes span\{[^}]*height:19px/)
  assert.match(swipe,/<button v-if="allowEdit" type="button" class="edit"/)
  assert.match(swipe,/<button v-if="allowDelete" type="button" class="delete"/)
})
