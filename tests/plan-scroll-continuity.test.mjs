import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const component=(name)=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8')
const plans=component('LifePanel.vue')
const sheet=component('EditBottomSheet.vue')

test('plan list survives asynchronous refresh without collapsing the scrolled document',()=>{
 const refresh=plans.slice(plans.indexOf('async function fetchMode(){'),
   plans.indexOf('defineExpose({refreshForSync:'))
 const beforeResults=refresh.slice(0,refresh.indexOf('const results=await Promise.allSettled('))
 assert.doesNotMatch(beforeResults,/items\.value=\[\];other\.value=\[\];goals\.value=\[\];trips\.value=\[\]/)
 assert.match(plans,/const planListReady=ref\(false\)/)
 assert.match(plans,/<div v-if="planListReady" class="life-grid" :aria-busy="listLoading"/)
 assert.doesNotMatch(plans,/<div v-else class="life-grid">/)
 assert.match(refresh,/if\(currentMode==='plans'\)planListReady\.value=true/)
 assert.match(refresh,/const requested=new Set\(kinds\)/)
 assert.match(refresh,/if\(!requested\.has\(kind\)\)assignRows\(kind,\[\]\)/)
})

test('background refresh retains the current task page but a filter change resets it',()=>{
 assert.match(plans,/const queryKey=\[selected,planScope\.value,planYear\.value,planMonth\.value,planOutcome\.value\]\.join\('\|'\)/)
 assert.match(plans,/const previousTaskPage=queryKey===lastPlanQueryKey\?taskPage\.value:0/)
 assert.match(plans,/while\(pages\[i\]\.nextCursor&&\(pages\[i\]\.items\|\|\[\]\)\.length<needed\)/)
 assert.match(plans,/taskPage\.value=Math\.min\(previousTaskPage,/)
 assert.match(plans,/lastPlanQueryKey=queryKey/)
})

test('bottom sheets pin iOS page scroll and restore original position on final close',()=>{
 assert.match(sheet,/savedScrollY=window\.scrollY/)
 assert.match(sheet,/document\.body\.style\.position='fixed'/)
 assert.match(sheet,/document\.body\.style\.top=-savedScrollY\+'px'/)
 assert.match(sheet,/if\(activeSheetLocks\+\+===0\)/)
 assert.match(sheet,/activeSheetLocks=Math\.max\(0,activeSheetLocks-1\)/)
 assert.match(sheet,/if\(activeSheetLocks===0\)\{/)
 assert.match(sheet,/document\.body\.style\.position=savedBodyPosition/)
 assert.match(sheet,/window\.scrollTo\(0,savedScrollY\)/)
 assert.match(sheet,/if\(previousFocus\?\.isConnected\)previousFocus\.focus\(\{preventScroll:true\}\)/)
})
