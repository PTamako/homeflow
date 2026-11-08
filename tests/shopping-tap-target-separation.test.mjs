import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const section=life.slice(life.indexOf('<template v-for="s in visibleShopping"'),
  life.indexOf('<p v-if="!visibleShopping.length'))

test('shopping ledger icon is placed before status on the first row',()=>{
  const title=section.slice(section.indexOf('<div class="shopping-title-row">'),
    section.indexOf('<div class="shopping-meta-row">'))
  const iconAt=title.indexOf('<AppIcon name="link"')
  const badgeAt=title.indexOf('<StatusBadge :code="s.completed_at')
  assert.ok(iconAt>0&&badgeAt>iconAt)
  assert.match(title, /class="shopping-ledger-icon"/)
  assert.match(title, /@click.stop="toggleLedger\(s.id\)"/)
  assert.match(title, /:aria-label="\(s.ledger_entry_id\?'查看关联账单：':'关联账单：'\)\+s.title"/)
})

test('More stays on second row and handler occupies third row without duplicate ledger action',()=>{
  const creator=section.slice(section.indexOf('<div class="shopping-meta-row">'),
    section.indexOf('<div class="shopping-handler-row">'))
  assert.match(creator, /class="routine-more-trigger shopping-more-trigger"/)
  assert.match(creator, /@click.stop="toggleTaskMenu\('shopping:'\+s.id\)"/)
  const handler=section.slice(section.indexOf('<div class="shopping-handler-row">'),
    section.indexOf('<small v-if="s.ledger_entry_id&&!s.completed_at">'))
  assert.match(handler, /class="shopping-assignees"/)
  assert.doesNotMatch(handler, /toggleLedger|shopping-ledger-link|shopping-more-trigger/)
  assert.match(handler, /@click="confirmShopping\(s\)"/)
})

test('compact icon retains at least 44px virtual touch area with status separating it from More',()=>{
  const width=Number(life.match(/\.shopping-heading-end \.shopping-ledger-icon\{[^}]*width:(\d+)px/)?.[1])
  const expand=Number(life.match(/\.shopping-heading-end \.shopping-ledger-icon::before\{[^}]*inset:-(\d+)px/)?.[1])
  assert.ok(width+2*expand>=44)
  assert.match(life,/\.shopping-heading-end\{[^}]*gap:9px/)
  assert.match(life,/\.shopping-heading-end :deep\(\.hf-status\)\{[^}]*flex:none/)
  assert.match(life,/\.shopping-meta-row \.shopping-more-trigger::before\{[^}]*inset:-8px/)
})
