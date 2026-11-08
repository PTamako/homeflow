import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const oneTime=life.slice(life.indexOf('<div v-for="t in [entry.item]"'),
  life.indexOf('<p v-if="!routines.length'))

test('one-time task keeps status on title line and More in summary line',()=>{
  const header=oneTime.slice(oneTime.indexOf('<div class="plan-task-head">'),
    oneTime.indexOf('<div class="routine-description-row once-task-description-row">'))
  assert.match(header, /<div class="plan-task-heading-actions">[\s\S]*?<StatusBadge class="plan-task-status"/)
  assert.doesNotMatch(header, /routine-more-trigger/)
  const summary=oneTime.slice(oneTime.indexOf('<div class="routine-description-row once-task-description-row">'),
    oneTime.indexOf('<small class="once-task-identity">'))
  assert.match(summary, /<small class="once-task-summary">[\s\S]*?<button v-if="planScope==='active'[\s\S]*?class="routine-more-trigger"/)
  assert.match(summary, /@click.stop="toggleTaskMenu\('task:'\+t.id\)"/)
  assert.match(life, /\.once-task-description-row>\.once-task-summary\{[^}]*flex:1;min-width:0;margin:0/)
  assert.match(life, /\.once-task-description-row>\.routine-more-trigger\{[^}]*width:28px;height:28px/)
})

test('one-time task menus and completion actions remain available',()=>{
  assert.match(oneTime, /v-if="expandedTaskMenu==='task:'\+t.id"/)
  assert.match(oneTime, /@click="completeOnce\(t\)"/)
  assert.match(oneTime, /@click.stop="toggleTaskMenu\('task:'\+t.id\)"/)
  assert.match(oneTime, /@click="expandedTaskMenu=null;toggleReminderEditor\('task',t.id\)"/)
})
