import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const sections={
  today:life.slice(life.indexOf('<template v-if="mode===\'today\'">'),life.indexOf('<template v-else-if="mode===\'family\'">')),
  family:life.slice(life.indexOf('<template v-else-if="mode===\'family\'">'),life.indexOf('<template v-else-if="mode===\'plans\'">')),
  plans:life.slice(life.indexOf('<template v-else-if="mode===\'plans\'">'),life.indexOf('<template v-else-if="mode===\'memories\'">'))
}
test('today is display-only for routines and anniversaries',()=>{
 assert.ok(sections.today.includes("v-for=\"r in routines\""))
 assert.ok(sections.today.includes('routine-completed'))
 assert.ok(sections.today.includes('countdown(e.nextOn)'))
 assert.ok(sections.today.includes(':datetime="e.nextOn"'))
 assert.ok(!sections.today.includes('submit.prevent="addRoutine"'))
 assert.ok(!sections.today.includes('submit.prevent="addAnniversary"'))
 assert.ok(life.includes('text-decoration:line-through'))
})
test('routine creation belongs under Plans and anniversary creation under Family',()=>{
 assert.ok(sections.plans.includes('submit.prevent="addRoutine"'))
 assert.ok(sections.plans.includes('定期任务设置'))
 assert.ok(sections.family.includes('submit.prevent="addAnniversary"'))
 assert.ok(!sections.plans.includes('submit.prevent="addAnniversary"'))
 assert.ok(!sections.family.includes('submit.prevent="addRoutine"'))
})
