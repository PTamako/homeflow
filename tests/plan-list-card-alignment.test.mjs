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
  assert.match(trips, /<div class="trip-title-row">\s*<b class="detail-name">{{ t.title }}<\/b>\s*<StatusBadge :code="t.status"/)
  assert.match(trips, /<div class="trip-participant-actions">\s*<span class="trip-participant-names"[\s\S]*?<div class="trip-card-actions">/)
  assert.match(life, /\.trip-participant-actions\{display:flex;align-items:center;justify-content:space-between/)
  assert.match(life, /\.trip-plan-row \.trip-card-actions\{[^}]*margin-left:auto/)
  assert.match(life, /\.trip-participant-names\{[^}]*text-overflow:ellipsis/)
  assert.match(trips, /@click.stop="selectTrip\(t.id\)"/)
  assert.match(trips, /@click.stop="toggleFinance\('trip',t.id\)"/)
})

test('savings status is right of title and dates share row with finance action',()=>{
  assert.match(goals, /<div class="goal-title-row">\s*<b class="detail-name">.*?<\/b>\s*<StatusBadge/)
  assert.match(goals, /<div class="goal-row-footer">\s*<small v-if="g.start_on" class="goal-dates">[\s\S]*?<button type="button" class="goal-finance-action"/)
  assert.doesNotMatch(goals, /<div class="goal-row-footer">\s*<StatusBadge/)
  assert.match(goals, /@click="toggleFinance\('goal',g.id\)"/)
})

test('shopping ledger icon is on title row before status; More remains by creator',()=>{
  assert.match(shopping, /<div class="shopping-title-row">[\s\S]*?<div class="shopping-heading-end">[\s\S]*?class="shopping-ledger-icon"[\s\S]*?<AppIcon name="link" :size="17"\/>[\s\S]*?<StatusBadge :code="s.completed_at/)
  assert.match(shopping, /:aria-label="\(s.ledger_entry_id\?'查看关联账单：':'关联账单：'\)\+s.title"/)
  assert.match(shopping, /@click.stop="toggleLedger\(s.id\)"/)
  assert.doesNotMatch(shopping, /class="shopping-ledger-link"/)
  assert.match(shopping, /<div class="shopping-meta-row">\s*<small class="shopping-plan-date">{{ s.due_on\?'计划日期：'\+s.due_on:'待安排' }}<\/small>[\s\S]*?<button v-if="planScope===/)
  assert.match(shopping, /class="routine-more-trigger shopping-more-trigger"/)
  assert.match(shopping, /@click.stop="toggleTaskMenu\('shopping:'\+s.id\)"/)
  assert.match(shopping, /<div class="shopping-handler-row">\s*<small class="shopping-assignees"[\s\S]*?<div v-if="!s.completed_at&&s.ledger_entry_id&&shoppingCompletable\(s\)" class="shopping-row-actions">/)
  assert.match(shopping, /@click="confirmShopping\(s\)"/)
  assert.match(life, /\.shopping-heading-end\{display:flex;align-items:center;justify-content:flex-end/)
  assert.match(life, /\.shopping-handler-row \.shopping-row-actions\{[^}]*margin-left:auto/)
})
