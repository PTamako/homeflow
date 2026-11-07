import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const styles=readFileSync(new URL('../src/ui-system.css',import.meta.url),'utf8')

test('recurring plan menu keeps four distinct contextual actions',()=>{
 const start=life.indexOf('class="routine-inline-actions"')
 assert.ok(start>=0,'recurring period actions have their own layout class')
 const menu=life.slice(start,life.indexOf('</div>',start))
 assert.equal((menu.match(/<button\b/g)||[]).length,4)
 for(const action of ['指派本期','提醒设置','通知处理人','跳过本期'])
  assert.ok(menu.includes(action),action)
})

test('four recurring task actions form a single narrow-screen-safe row',()=>{
 assert.match(styles,/.shell .routine-inline-actions\\[id\\^="routine-actions-"\\]\{\s*display:grid;\s*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
 assert.match(styles,/.routine-inline-actions\\[id\\^="routine-actions-"\\] > button\{[\s\S]*?min-width:0;[\s\S]*?white-space:nowrap;/)
 assert.match(styles,/.routine-inline-actions\\[id\\^="routine-actions-"\\] > button\{[\s\S]*?min-height:44px;/)
 assert.match(styles,/@media\(max-width:359px\)/)
})
