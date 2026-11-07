import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const finance=readFileSync(new URL('../src/components/FinancePanel.vue',import.meta.url),'utf8')
const trips=readFileSync(new URL('../worker/trips.js',import.meta.url),'utf8')
const financeApi=readFileSync(new URL('../worker/finance.js',import.meta.url),'utf8')

test('travel expenses expose direct compact entry without duplicated full-width actions',()=>{
  const block=life.slice(life.indexOf('<section v-if="planType===\'all\'||planType===\'trip\'"'),
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
  assert.match(life, /'PATCH',\{status:'completed'\}/)
  const progress=trips.slice(trips.indexOf("if(bpath[3]==='progress'"),trips.indexOf("if(bpath[3]==='progress'")+900)
  assert.doesNotMatch(progress, /status='completed'/)
})

test('itinerary removes duplicated time and never prints internal packing owner id',()=>{
  assert.match(life, /tripDisplayTitle\(it\)/)
  assert.match(life, /行李清单<\/b>/)
  assert.doesNotMatch(life, /行李清单 · \{\{ list\.owner \}\}/)
})

test('many travel expense links are supported without duplicate ledger writes',()=>{
  assert.match(finance, /已关联支出 · \{\{ links\.filter/)
  assert.match(finance, /v-for="row in visibleLinks"/)
  assert.match(finance, /@click="linkEntry\(row\)"/)
  assert.match(financeApi, /INSERT OR IGNORE INTO finance_links/)
  assert.doesNotMatch(financeApi, /INSERT INTO entries|INSERT INTO ledger_entries/)
  assert.match(financeApi, /if\(!owner&&path!=='\/api\/finance\/status'&&\!sharedGoalRead\)/)
})
