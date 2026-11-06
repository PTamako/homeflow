import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source=readFileSync(new URL('../src/components/LifePanel.vue', import.meta.url),'utf8')

test('shopping actions share their item separator without a dashed divider',()=>{
  assert.match(source, /class="shopping-plan-entry"/)
  assert.match(source, /class="routine-inline-actions shopping-inline-actions"/)
  assert.match(source, /\.shopping-plan-entry\{[^}]*border-bottom:1px solid/)
  assert.match(source, /\.shopping-plan-entry \.shopping-line\{border-bottom:0\}/)
  assert.match(source, /\.shopping-plan-entry \.shopping-inline-actions\{border-top:0[^}]*\}/)
})
