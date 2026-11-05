import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('Today and Plans use exactly one shared one-time form',()=>{
 const today=read('src/App.vue'),plans=read('src/components/PlanCreator.vue')
 const fields=read('src/components/OneTimeTaskFields.vue')
 assert.match(today,/<OneTimeTaskFields ref="newTaskFields" v-model="newTask" :profiles="profiles"\/>/)
 assert.match(plans,/<OneTimeTaskFields v-if="form\.repeatType==='once'" v-model="onceDraft" :profiles="profiles"\/>/)
 assert.match(fields,/v-model="model\.title"/)
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
test('both entry points use one task payload, private default and the same /api/tasks persistence',()=>{
 const today=read('src/App.vue'),plans=read('src/components/PlanCreator.vue')
 const model=read('src/one-time-task.ts')
 assert.match(today,/oneTimeTaskPayload\(newTask\.value,isPet\(newTask\.value\.subjectProfileId\)\)/)
 assert.match(today,/sendOrQueueTask\(user\.value\.id,'create',payload\)/)
 assert.match(plans,/send\('\/tasks',oneTimeTaskPayload\(onceDraft\.value,oncePet\.value\)\)/)
 assert.match(model,/visibility:'private',dueOn:today,remindEnabled:true/)
 assert.match(model,/remindEnabled:!!draft\.dueOn&&draft\.remindEnabled/)
 assert.match(model,/healthRecordType:isPet\?\(draft\.healthRecordType\|\|null\):null/)
 assert.match(plans,/savedUnscheduled=kind\.value==='routine'&&form\.repeatType==='once'&&!onceDraft\.value\.dueOn/)
 assert.ok(!model.includes('routines'))
})
