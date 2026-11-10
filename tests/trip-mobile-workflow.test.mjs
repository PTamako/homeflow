import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const finance=readFileSync(new URL('../src/components/FinancePanel.vue',import.meta.url),'utf8')
const tripEditor=readFileSync(new URL('../src/components/LifeItemEditor.vue',import.meta.url),'utf8')
const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
const trips=readFileSync(new URL('../worker/trips.js',import.meta.url),'utf8')
const financeApi=readFileSync(new URL('../worker/finance.js',import.meta.url),'utf8')

test('travel expenses expose direct compact entry without duplicated full-width actions',()=>{
  const block=life.slice(life.indexOf('<section v-if="(planType===\'all\'||planType===\'trip\')"'),
    life.indexOf('<div v-if="tripDetail" class="trip-detail">'))
  assert.match(block, /class="life-link trip-finance-trigger"/)
  assert.match(block, /@click\.stop="toggleFinance\('trip',t\.id\)"/)
  assert.doesNotMatch(block, />费用与调整额<\/button>/)
  assert.match(block, /class="trip-section-header"/)
})

test('progress and overall travel completion stay separate',()=>{
  assert.match(life, /tripItineraryCompleted=computed/)
  assert.match(life, /class="trip-progress-track"/)
  assert.match(life, /@click="completeTrip"/)
  assert.match(life, /status:'completed'/)
  const progress=trips.slice(trips.indexOf("if(bpath[3]==='progress'"),trips.indexOf("if(bpath[3]==='progress'")+900)
  assert.doesNotMatch(progress, /status='completed'/)
})

test('itinerary removes duplicated time and never prints internal packing owner id',()=>{
  assert.match(life, /tripDisplayTitle\(it\)/)
  assert.match(life, /行李清单<\/b>/)
  assert.doesNotMatch(life, /行李清单 · \{\{ list\.owner \}\}/)
})

test('many travel expense links are supported without duplicate ledger writes',()=>{
  assert.match(finance, /已关联支出 · \{\{ linkedTripCount/)
  assert.match(finance, /v-for="row in visibleLinks"/)
  assert.match(finance, /@click="linkEntry\(row\)"/)
  assert.match(financeApi, /INSERT OR IGNORE INTO finance_links/)
  assert.doesNotMatch(financeApi, /INSERT INTO entries|INSERT INTO ledger_entries/)
  assert.match(financeApi, /if\(!owner&&path!=='\/api\/finance\/status'&&!sharedGoalRead&&!sharedTripRead\)/)
})

test('mobile participant choices remain compact and readable on iPhone in both sheets',()=>{
 for(const source of [creator,tripEditor]){
  assert.match(source, /\.trip-participants-field\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(source, /\.trip-participant-option>input\[type="checkbox"\]\{[^}]*flex:0 0 18px;[^}]*width:18px;[^}]*min-height:18px;[^}]*padding:0/)
  assert.match(source, /\.trip-participant-option>span\{[^}]*min-width:0;[^}]*text-overflow:ellipsis;white-space:nowrap/)
  assert.match(source, /\.trip-participant-option:has\(input:checked\)/)
  assert.doesNotMatch(source, /trip-scoring-note/)
 }
 assert.match(tripEditor, /class="trip-participant-option"/)
 assert.match(creator, /class="trip-participant-option"/)
})

test('whole trip completion is independent from checklist ticks and explains reward settlement',()=>{
 const start=life.indexOf('async function completeTrip(){')
 const finish=life.indexOf('function editTripItem',start)
 const source=life.slice(start,finish)
 assert.match(source, /const unfinished=tripItineraryItems\.value\.length-tripItineraryCompleted\.value/)
 assert.match(source, /未勾选，但不影响旅行完成和积分/)
 assert.match(source, /status:'completed'/)
 assert.match(source, /longTripNeedsConfirmation\(days\)/)
 assert.match(source, /confirm\(longTripWarning\(days\)\)/)
 assert.match(source, /longTripConfirmed:true/)
 assert.doesNotMatch(source, /if\(unfinished\s*>\s*0\)return/)
 assert.match(life, /行程清单 \{\{ tripItineraryCompleted \}\}/)
})
