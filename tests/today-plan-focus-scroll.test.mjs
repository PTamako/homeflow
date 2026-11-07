import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const panel=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('Today 去处理 keeps the old page height while first plan page is loading',()=>{
 const start=app.indexOf('function openPlans('),end=app.indexOf('function onPlanFocusSettled(',start)
 const navigation=app.slice(start,end)
 assert.match(navigation,/focusPlanFromToday\.value=tab\.value==='today'&&!!id/)
 assert.match(navigation,/planFocusHoldHeight\.value=Math\.ceil\(document\.documentElement\.scrollHeight\)/)
 assert.ok(navigation.indexOf('planFocusHoldHeight.value')<navigation.indexOf("tab.value='plans'"))
 assert.match(app, /<main v-else class="content" :style="planFocusHoldHeight\?/)
 assert.match(app, /@plan-focus-settled="onPlanFocusSettled"/)
 assert.match(app, /requestId===focusPlanRequest\.value&&tab\.value==='plans'\)planFocusHoldHeight\.value=0/)
 assert.match(app, /function navigateTab\([\s\S]*?planFocusHoldHeight\.value=0/)
 assert.match(app, /function clearPlanFocus\([\s\S]*?planFocusHoldHeight\.value=0/)
})

test('initial focused plan row is rendered before attempting the jump',()=>{
 const begin=panel.indexOf("}else if(props.mode==='plans'){",panel.indexOf('async function fetchMode()'))
 const end=panel.indexOf("}else if(props.mode==='memories'){",begin)
 const branch=panel.slice(begin,end)
 const ready=branch.lastIndexOf('planListReady.value=true')
 const rendered=branch.lastIndexOf('await nextTick()')
 const focus=branch.lastIndexOf('await focusExactPlan(requestId)')
 assert.ok(begin>0&&ready>0&&rendered>ready&&focus>rendered)
 assert.match(panel,/v-if="planListReady" class="life-grid"/)
})

test('later sync refresh cannot scroll the plans list to the top again',()=>{
 const start=panel.indexOf('async function focusExactPlan(')
 const end=panel.indexOf('async function finishWish(',start)
 const source=panel.slice(start,end)
 assert.match(panel, /let lastFocusedScrollKey=''/)
 assert.match(source,/lastFocusedScrollKey!==focusKey/)
 assert.match(source,/lastFocusedScrollKey===focusKey\)return/)
 assert.match(source,/lastFocusedScrollKey=focusKey/)
 assert.match(source,/window\.scrollTo\(\{top:Math\.max\(0,row\.getBoundingClientRect\(\)\.top\+window\.scrollY-176\),behavior:'instant'\}\)/)
 assert.match(source,/emit\('planFocusSettled',props\.focusPlanRequest\|\|0\)/)
 const scrollCalls=(source.match(/window\.scrollTo\(/g)||[]).length
 assert.equal(scrollCalls,1,'one guarded scroll site per navigation')
})
