import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const goals=life.slice(life.indexOf('<template v-for="g in goals"'),life.indexOf('<p v-if="!goals.length'))
const shopping=life.slice(life.indexOf('<template v-for="s in visibleShopping"'),life.indexOf('<p v-if="!visibleShopping.length'))
const trips=life.slice(life.indexOf('<template v-for="t in trips"'),life.indexOf('<p v-if="!trips.length'))

test('trip participants and status stay together on a dedicated full-width row',()=>{
  assert.match(trips, /class="life-row trip-plan-row"/)
  assert.match(trips, /class="trip-summary-line"/)
  assert.match(trips, /<div class="trip-participant-status">\s*<span>参与 {{ tripParticipantNames\(t\) }}<\/span>\s*<StatusBadge :code="t.status"/)
  assert.match(life, /\.trip-participant-status\{grid-column:1\/-1;display:flex/)
  assert.match(trips, /@click.stop="selectTrip\(t.id\)"/)
  assert.match(trips, /@click.stop="toggleFinance\('trip',t.id\)"/)
})

test('savings status is right of title and dates share row with finance action',()=>{
  assert.match(goals, /<div class="goal-title-row">\s*<b class="detail-name">.*?<\/b>\s*<StatusBadge/)
  assert.match(goals, /<div class="goal-row-footer">\s*<small v-if="g.start_on" class="goal-dates">[\s\S]*?<button type="button" class="goal-finance-action"/)
  assert.doesNotMatch(goals, /<div class="goal-row-footer">\s*<StatusBadge/)
  assert.match(goals, /@click="toggleFinance\('goal',g.id\)"/)
})

test('shopping status sits on title row; creator and ledger action share right-aligned row',()=>{
  assert.match(shopping, /<div class="shopping-title-row">[\s\S]*?<StatusBadge :code="s.completed_at/)
  assert.match(shopping, /<div class="shopping-meta-row">\s*<small class="shopping-creator">发起人：[\s\S]*?<div class="shopping-row-actions">/)
  assert.match(shopping, /class="shopping-assignees">处理人：/)
  assert.match(shopping, /@click="toggleLedger\(s.id\)"/)
  assert.match(shopping, /@click="confirmShopping\(s\)"/)
  assert.match(shopping, /@click.stop="toggleTaskMenu\('shopping:'\+s.id\)"/)
  assert.match(life, /\.shopping-meta-row \.shopping-row-actions\{[^}]*margin-left:auto/)
})
