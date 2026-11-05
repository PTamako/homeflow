import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('Today redirects to the single Plans one-time form',()=>{
 const today=read('src/App.vue'),plans=read('src/components/PlanCreator.vue')
 const life=read('src/components/LifePanel.vue')
 const fields=read('src/components/OneTimeTaskFields.vue')
 assert.match(today,/@click="openNewTaskInPlans">＋ 新增待办/)
 assert.match(today,/navigateTab\('plans'\)[\s\S]*?openPlanCreatorOnNavigate\.value=true/)
 assert.match(today,/:open-plan-creator="openPlanCreatorOnNavigate"/)
 assert.match(life,/:open-on-mount="props.openPlanCreator"/)
 assert.match(plans,/const opened=ref\(!!props.openOnMount\)/)
 assert.match(plans,/<OneTimeTaskFields v-if="form\.repeatType==='once'" v-model="onceDraft" :profiles="profiles"\/>/)
 assert.doesNotMatch(today,/<OneTimeTaskFields|@submit\.prevent="addTask"|showAddTask/)
 assert.match(fields,/v-model\.trim="model\.title"/)
 assert.match(fields,/v-model="model\.dueOn"/)
 assert.match(fields,/v-model="model\.remindEnabled"/)
 assert.match(fields,/v-model="model\.subjectProfileId"/)
 assert.match(fields,/v-model="model\.healthRecordType"/)
 assert.match(fields,/v-model="model\.visibility"/)
 assert.match(fields,/aria-label="清空计划日期"/)
 assert.match(fields,/未指定日期的任务将保存到「计划 → 待安排」/)
 assert.match(fields,/v-if="linkedPet"/)
 assert.match(fields,/model\.value\.healthRecordType=linkedPet\.value\?'other':''/)
})

test('the sole creation entry keeps the existing one-time task payload and private defaults',()=>{
 const today=read('src/App.vue'),plans=read('src/components/PlanCreator.vue')
 const model=read('src/one-time-task.ts')
 assert.doesNotMatch(today,/oneTimeTaskPayload\(newTask\.value/)
 assert.match(plans,/send\('\/tasks',oneTimeTaskPayload\(onceDraft\.value,oncePet\.value\)\)/)
 assert.match(model,/visibility:'private',dueOn:today,remindEnabled:true/)
 assert.match(model,/remindEnabled:!!draft\.dueOn&&draft\.remindEnabled/)
 assert.match(model,/healthRecordType:isPet\?\(draft\.healthRecordType\|\|null\):null/)
 assert.match(plans,/savedUnscheduled=kind\.value==='routine'&&form\.repeatType==='once'&&!onceDraft\.value\.dueOn/)
 assert.ok(!model.includes("send('/routines'"))
})
