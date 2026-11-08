import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const creator=readFileSync(new URL('../src/components/OneTimeTaskFields.vue',import.meta.url),'utf8')
const payload=readFileSync(new URL('../src/one-time-task.ts',import.meta.url),'utf8')
const taskApi=readFileSync(new URL('../worker/tasks.js',import.meta.url),'utf8')
const routineApi=readFileSync(new URL('../worker/routine-assignments.js',import.meta.url),'utf8')

test('routine two-person selection hides paid bonus and resets prior value',()=>{
  assert.match(life, /<label v-if="routineAssignMember&&!routineAssignSecond&&routineAssignMember!==props.userId">/)
  assert.match(life, /if\(routineAssignSecond.value\|\|!routineAssignMember.value\|\|routineAssignMember.value===props.userId\)/)
  assert.match(life, /parseRoutineAssignmentBonus\(routineAssignBonus.value,other&&!routineAssignSecond.value\)/)
  assert.match(life, /两人中任一人完成，双方平分基础积分，不设置额外奖励/)
})

test('new one-time tasks cannot show or submit dual-assignee bonus',()=>{
  assert.match(creator, /!model.secondAssigneeUserId&&model.assigneeUserId!==userId&&model.visibility==='household'/)
  assert.match(creator, /if\(model.value.secondAssigneeUserId\)model.value.bonusPoints=0/)
  assert.match(creator, /仅平分基础积分，无额外奖励/)
  assert.match(payload, /bonusPoints:draft.assigneeUserId&&!draft.secondAssigneeUserId\?draft.bonusPoints\|\|0:0/)
})

test('editing one-time tasks also clears dual-assignee bonus and hides input',()=>{
  assert.match(life, /<select v-model="onceSecondAssignee"[^>]*@change="onceSecondAssignee\?onceBonus=0:null"/)
  assert.match(life, /v-if="onceAssignee&&!onceSecondAssignee&&onceAssignee!==props.userId&&onceVisibility==='household'"/)
  assert.match(life, /bonusPoints:onceVisibility.value==='household'&&onceAssignee.value&&!onceSecondAssignee.value&&onceAssignee.value!==props.userId\?onceBonus.value:0/)
})

test('backend has independent zero-bonus rules for both task types',()=>{
  assert.match(taskApi, /if\(second\?\(visibility!=='household'\|\|bonus!==0\):/)
  assert.match(routineApi, /if\(second&&bonus!==0\)return json\(\{error:'dual_assignee_bonus_not_allowed'\},400\)/)
})
