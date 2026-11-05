import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
const picker=readFileSync(new URL('../src/components/ShoppingLedgerPicker.vue',import.meta.url),'utf8')
const panel=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('shopping receipt picker stays open for multiple verified expenses',()=>{
  assert.match(panel,/@saved="shoppingLinksChanged"/)
  assert.match(panel,/async function shoppingLinksChanged\(\)/)
  assert.match(panel,/api\('\/shopping\/'\+encodeURIComponent\(id\)\)/)
  assert.match(panel,/other\.value\.splice\(idx,1,data\.item\)/)
  assert.ok(!panel.includes('@saved="changed" @close="ledgerPickerId=null"'))
})
test('already linked receipts cannot be linked again by candidate button',()=>{
  assert.match(picker,/linkedEntryIds=computed/)
  assert.match(picker,/linkedEntryIds\.has\(String\(entry\.id\)\)/)
  assert.match(picker,/await loadLinks\(\)\s*emit\('saved'\)/)
  assert.match(picker,/解除这一笔/)
})

test('shopping links complete on receipt association with no quantity or amount allocation fields',()=>{
  assert.match(picker,/关联一笔真实账单后，这件物品即完成/)
  assert.match(picker,/{entryId:entry.id}/)
  assert.doesNotMatch(picker,/buyQty|本次购买数量|购物金额调整|saveAdjustment|purchasedCount/)
  assert.match(panel,/s\.completed_at\?'已完成':'待购买'/)
})
