import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const slash=String.fromCharCode(92)

test('joint reward dialogs use real newline escapes, not literal backslash-n text',()=>{
 const dialogs=source.split('\n').filter(x=>x.includes('window.confirm(')&&
  (x.includes('创建「')||x.includes('确认出资 ')||x.includes('取消「')))
 assert.equal(dialogs.length,3)
 for(const dialog of dialogs){
  assert.ok(dialog.includes(slash+'n'),'confirmation has a readable line break')
  assert.ok(!dialog.includes(slash+slash+'n'),'literal \\n must not render')
 }
})

test('whole-order cancellation and automatic refund remain available while collecting',()=>{
 assert.ok(source.includes("'/rewards/pool/'+item.id+'/cancel'"))
 assert.ok(source.includes('取消并退分'))
})
