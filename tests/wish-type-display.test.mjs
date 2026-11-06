import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {wishTypeLabel} from '../src/wish-type-display.mjs'

test('every supported wish_type is a readable Chinese label in lists',()=>{
  for(const [code,label] of Object.entries({
    purchase:'购物',trip:'旅行',activity:'体验',other:'其他'
  })){
    assert.equal(wishTypeLabel(code),label)
    assert.equal(wishTypeLabel(code.toUpperCase()),label)
  }
})

test('unexpected or absent values never leak raw backend codes into the UI',()=>{
  for(const value of [null,undefined,'','unknown_kind',' purchase_old ']){
    assert.equal(wishTypeLabel(value),'其他')
  }
})

test('the plans list localizes only the display and keeps stored values for workflows',()=>{
  const ui=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
  assert.match(ui,/import \{wishTypeLabel\} from '\.\.\/wish-type-display\.mjs'/)
  assert.match(ui,/\{\{ wishTypeLabel\(w\.wish_type\) \}\}/)
  assert.doesNotMatch(ui,/\{\{ w\.wish_type \}\}/)
  assert.match(ui,/w\.wish_type==='trip'/)
  assert.match(ui,/openPlans','goal'/)
})
