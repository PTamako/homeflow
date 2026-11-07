import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const styles=readFileSync(new URL('../src/ui-system.css',import.meta.url),'utf8')

test('recurring plan menu keeps four distinct contextual actions',()=>{
 const start=life.indexOf('class="routine-inline-actions"')
 assert.ok(start>=0)
 const menu=life.slice(start,life.indexOf('</div>',start))
 assert.equal((menu.match(/<button\\b/g)||[]).length,4)
 for(const action of ['指派本期','提醒设置','通知处理人','跳过本期'])
  assert.ok(menu.includes(action),action)
})

test('four routine actions fit in one mobile grid row',()=>{
 const selector='.shell .routine-inline-actions[id^="routine-actions-"]'
 const start=styles.indexOf(selector+'{')
 assert.ok(start>=0,'routine actions have an isolated CSS rule')
 const grid=styles.slice(start,styles.indexOf('}',start))
 assert.ok(grid.includes('display:grid'))
 assert.ok(grid.includes('grid-template-columns:repeat(4,minmax(0,1fr))'))
 const buttonRule=styles.slice(styles.indexOf(selector+' > button{'))
 assert.ok(buttonRule.includes('min-width:0'))
 assert.ok(buttonRule.includes('white-space:nowrap'))
 assert.ok(buttonRule.includes('min-height:44px'))
 assert.ok(styles.includes('@media(max-width:359px)'))
})
