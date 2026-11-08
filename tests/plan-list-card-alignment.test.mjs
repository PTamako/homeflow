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

test('shopping ledger is a plain-text affordance next to assignees on one row',()=>{
  assert.match(shopping, /<div class="shopping-title-row">[\s\S]*?<StatusBadge :code="s.completed_at/)
  assert.match(shopping, /<div class="shopping-meta-row">\s*<small class="shopping-creator">发起人：/)
  assert.match(shopping, /<div class="shopping-handler-row">\s*<small class="shopping-assignees"[\s\S]*?<div class="shopping-row-actions">/)
  assert.match(shopping, /class="shopping-ledger-link" @click="toggleLedger\(s.id\)"/)
  assert.doesNotMatch(shopping, /class="life-link" @click="toggleLedger\(s.id\)"/)
  assert.match(life, /\.shopping-handler-row \.shopping-ledger-link\{[^}]*background:transparent/)
  assert.match(life, /\.shopping-handler-row>\.shopping-assignees\{[^}]*white-space:nowrap/)
  assert.match(life, /\.shopping-handler-row \.shopping-row-actions\{[^}]*margin-left:auto/)
  assert.match(shopping, /@click="confirmShopping\(s\)"/)
  assert.match(shopping, /<div class="shopping-meta-row">\s*<small class="shopping-creator">发起人：[\s\S]*?<button v-if="planScope===/)
  assert.match(shopping, /class="routine-more-trigger shopping-more-trigger"/)
  assert.match(shopping, /@click.stop="toggleTaskMenu\('shopping:'\+s.id\)"/)
  assert.doesNotMatch(shopping.slice(shopping.indexOf('<div class="shopping-handler-row">'),shopping.indexOf('</div>',shopping.indexOf('<div class="shopping-handler-row">'))), /shopping-more-trigger/)
  assert.match(life, /\.shopping-meta-row \.shopping-more-trigger\{[^}]*margin-left:auto/ )
})
