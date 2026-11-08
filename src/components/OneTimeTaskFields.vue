<script setup lang="ts">
import {computed,ref} from 'vue'
import DateField from './DateField.vue'
import type {OneTimeTaskDraft} from '../one-time-task'

const props=defineProps<{
  profiles:Array<{id:string;displayName:string;type:string}>
  members?:Array<{id:string;loginName:string}>
  userId?:string
}>()
const model=defineModel<OneTimeTaskDraft>({required:true})
const titleInput=ref<HTMLInputElement|null>(null)
const linkedPet=computed(()=>props.profiles.some(p=>p.id===model.value.subjectProfileId&&p.type==='pet'))
function subjectChanged(){
  model.value.healthRecordType=linkedPet.value?'other':''
}
function assigneeChanged(){
 if(!model.value.assigneeUserId||model.value.secondAssigneeUserId===model.value.assigneeUserId)
   model.value.secondAssigneeUserId=''
 if((model.value.assigneeUserId&&model.value.assigneeUserId!==props.userId)||
    (model.value.secondAssigneeUserId&&model.value.secondAssigneeUserId!==props.userId))model.value.visibility='household'
 else model.value.bonusPoints=0
 if(model.value.secondAssigneeUserId)model.value.bonusPoints=0
}
function visibilityChanged(){
 if(model.value.visibility==='private'){model.value.assigneeUserId=props.userId||'';model.value.secondAssigneeUserId='';model.value.bonusPoints=0}
}
function focusTitle(){titleInput.value?.focus()}
defineExpose({focusTitle})
</script>
<template>
 <div class="once-fields">
  <label>任务名称
   <input ref="titleInput" v-model.trim="model.title" required maxlength="150"
     placeholder="例如：给豆沙买猫粮" aria-label="任务名称"/>
  </label>
  <div class="once-date">
   <div class="once-date-heading"><span id="one-time-task-date-label">计划日期（可选）</span></div>
   <DateField v-model="model.dueOn" aria-labelledby="one-time-task-date-label"/>
   <small v-if="!model.dueOn" class="once-hint">不选日期将存入「待安排」。</small>
  </div>
  <label class="once-check">
   <input v-model="model.remindEnabled" type="checkbox" :disabled="!model.dueOn"/>
   <span>开启提醒<small v-if="!model.dueOn">安排日期后才能提醒</small></span>
  </label>
  <label>关联家人或宠物（可选）
   <select v-model="model.subjectProfileId" aria-label="关联对象" @change="subjectChanged">
    <option value="">不关联</option>
    <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
      {{ profile.displayName }}（{{ profile.type==='pet'?'宠物':'家人' }}）
    </option>
   </select>
  </label>
  <label v-if="linkedPet">完成后写入宠物护理记录
   <select v-model="model.healthRecordType" aria-label="护理记录类型">
    <option value="">不自动记录</option>
    <option value="other">日常护理</option>
    <option value="grooming">梳毛／洗澡</option>
    <option value="medication">用药</option>
    <option value="deworm">驱虫</option>
    <option value="vaccination">疫苗</option>
    <option value="vet">就诊</option>
   </select>
  </label>
  <label>处理人
   <select v-model="model.assigneeUserId" aria-label="选择任务处理人" @change="assigneeChanged">
    <option value="">未指派</option>
    <option v-for="member in (members||[])" :key="member.id" :value="member.id">{{ member.loginName }}{{ member.id===userId?'（我）':'' }}</option>
   </select>
  </label>
  <label v-if="model.visibility==='household'&&model.assigneeUserId">共同处理人（可选）
   <select v-model="model.secondAssigneeUserId" aria-label="选择第二位处理人" @change="assigneeChanged">
    <option value="">仅一人负责</option>
    <option v-for="member in (members||[])" :key="member.id" :value="member.id"
      :disabled="member.id===model.assigneeUserId">{{ member.loginName }}{{ member.id===userId?'（我）':'' }}</option>
   </select>
   <small v-if="model.secondAssigneeUserId">两人任意一人完成即可，仅平分基础积分，无额外奖励。</small>
  </label>
  <label v-if="model.assigneeUserId&&!model.secondAssigneeUserId&&model.assigneeUserId!==userId&&model.visibility==='household'">额外任务奖励（从我的家庭积分预留）
   <input v-model.number="model.bonusPoints" type="number" inputmode="numeric" min="1" max="10000" step="1" required placeholder="必须填写正整数" aria-label="一次性任务额外奖励积分"/>
   <small>完成后转给指定处理人；撤销完成退回预留状态，删除任务解除预留。基础完成奖励另有 5 分。</small>
  </label>
  <label>可见范围
   <select v-model="model.visibility" aria-label="可见范围" @change="visibilityChanged">
    <option value="private">仅自己</option>
    <option value="household">家庭共享</option>
   </select>
  </label>
 </div>
</template>
<style scoped>
.once-fields{display:grid;gap:12px;min-width:0}
.once-fields label{display:grid;gap:5px;min-width:0;color:#5d7769;font-size:12px;line-height:1.45}
.once-fields input:not([type=checkbox]),.once-fields select{
  display:block;box-sizing:border-box;min-inline-size:0;max-inline-size:100%;inline-size:100%;
  border:1px solid #d9e4db;border-radius:10px;background:#fff;color:#304838;
  min-height:44px;padding:8px 10px;font-size:16px
}
.once-date{display:grid;gap:6px;min-inline-size:0}
.once-date-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#5d7769;font-size:12px}
.once-hint{color:#849588;font-size:11px;line-height:1.5}
.once-fields .once-check{display:flex;align-items:center;gap:9px;min-height:35px}
.once-check input{inline-size:19px;block-size:19px;flex:none;accent-color:#43866a}
.once-check span{display:grid;gap:2px;color:#304838}
.once-check small{font-size:11px;color:#849588}
</style>
