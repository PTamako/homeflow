import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('active routine more icon is visibly compact even when expanded, with extended touch area',()=>{
  assert.match(source,/\.routine-description-row>\.routine-more-trigger\{[^}]*width:28px;height:28px;min-width:28px;min-height:28px/)
  assert.match(source,/\.routine-description-row>\.routine-more-trigger\[aria-expanded="true"\]\{[^}]*background:transparent/)
  assert.match(source,/\.routine-description-row>\.routine-more-trigger::before\{[^}]*inset:-8px/)
  assert.match(source,/@click.stop="toggleTaskMenu\('routine:'\+r.id\)"/)
})

test('shopping cards keep all three rows while reducing padding and control heights',()=>{
  const shopping=source.slice(source.indexOf('<template v-for="s in visibleShopping"'),source.indexOf('<p v-if="!visibleShopping.length'))
  assert.match(shopping, /class="shopping-title-row"/)
  assert.match(shopping, /class="shopping-meta-row"/)
  assert.match(shopping, /class="shopping-handler-row"/)
  assert.match(source,/\.shopping-plan-entry \.shopping-line\{[^}]*padding:6px 0/)
  assert.match(source,/\.shopping-meta-row \.shopping-more-trigger\{[^}]*width:28px;min-width:28px;height:28px;min-height:28px/)
  assert.match(source,/\.shopping-heading-end \.shopping-ledger-icon\{[^}]*width:32px;height:32px;min-width:32px;min-height:32px/)
  assert.match(source,/\.shopping-heading-end \.shopping-ledger-icon::before\{[^}]*inset:-6px/)
  assert.match(shopping,/@click.stop="toggleLedger\(s.id\)"/)
  assert.match(shopping,/@click="confirmShopping\(s\)"/)
})
