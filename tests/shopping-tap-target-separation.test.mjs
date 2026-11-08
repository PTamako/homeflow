import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const section=life.slice(life.indexOf('<template v-for="s in visibleShopping"'),
  life.indexOf('<p v-if="!visibleShopping.length'))

test('shopping ledger remains inline with assignees, not vertically aligned under More',()=>{
  assert.match(section,/<div class="shopping-meta-row">[\s\S]*?class="routine-more-trigger shopping-more-trigger"/)
  assert.match(section,/<div class="shopping-handler-row">\s*<small class="shopping-assignees"[\s\S]*?<div class="shopping-row-actions">[\s\S]*?class="shopping-ledger-link"/)
  assert.match(life,/\.shopping-handler-row\{[^}]*justify-content:flex-start;[^}]*padding-right:52px/)
  assert.match(life,/\.shopping-handler-row>\.shopping-assignees\{[^}]*flex:0 1 auto/)
  assert.match(life,/\.shopping-handler-row \.shopping-row-actions\{[^}]*margin-left:0/)
  assert.match(section,/@click="toggleLedger\(s.id\)"/)
  assert.match(section,/@click.stop="toggleTaskMenu\('shopping:'\+s.id\)"/)
})

test('expanded hit areas leave horizontal clearance between actions',()=>{
  const lane=Number(life.match(/\.shopping-handler-row\{[^}]*padding-right:(\d+)px/)?.[1])
  const moreWidth=Number(life.match(/\.shopping-meta-row \.shopping-more-trigger\{[^}]*width:(\d+)px/)?.[1])
  const moreExtra=Number(life.match(/\.shopping-meta-row \.shopping-more-trigger::before\{[^}]*inset:-(\d+)px/)?.[1])
  const ledgerExtra=Number(life.match(/\.shopping-handler-row \.shopping-ledger-link::before\{[^}]*inset:-\d+px -(\d+)px/)?.[1])
  assert.ok(Number.isFinite(lane)&&Number.isFinite(moreWidth)&&Number.isFinite(moreExtra)&&Number.isFinite(ledgerExtra))
  assert.ok(lane>moreWidth+moreExtra+ledgerExtra,
    'expanded More and ledger hit areas must stay horizontally separated')
})
