<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue'
import AppIcon from './AppIcon.vue'
import {additionalReminders} from '../today-presentation.mjs'

type Reminder={id:string;kind:string;title:string;dueOn:string}
const props=defineProps<{todayDate:string;todayEntryKeys:string[]}>()
const items=ref<Reminder[]>([])
const loading=ref(false)
const error=ref('')
let requestId=0
const visibleReminders=computed(()=>additionalReminders(items.value,props.todayEntryKeys) as Reminder[])

async function load(){
 const current=++requestId
 loading.value=true
 error.value=''
 try{
  const res=await fetch('/api/reminders?date='+encodeURIComponent(props.todayDate),{
   credentials:'same-origin',cache:'no-store'})
  if(!res.ok)throw Error('无法读取今天的重要提醒')
  const data=await res.json() as {items?:Reminder[]}
  if(current!==requestId)return
  items.value=data.items||[]
 }catch(e){
  if(current!==requestId)return
  items.value=[]
  error.value=(e as Error).message
 }finally{
  if(current===requestId)loading.value=false
 }
}
// The component only exists on Today's page. Load automatically on entry,
// refresh on JST date rollover, and ignore old responses when navigating away.
watch(()=>props.todayDate,()=>{void load()},{immediate:true})
onBeforeUnmount(()=>{requestId++})
</script>

<template>
  <section class="panel important-reminders" aria-label="重要提醒">
    <div class="reminder-heading">
      <h2><AppIcon name="bell" :size="20" /> 重要提醒</h2>
      <button class="text-button" type="button" :disabled="loading" @click="load">刷新</button>
    </div>
    <p v-if="loading" class="reminder-status" role="status">正在读取今天的提醒…</p>
    <template v-else-if="error">
      <p role="alert" class="reminder-error">{{ error }}</p>
      <button type="button" class="text-button" @click="load">重试</button>
    </template>
    <p v-else-if="!visibleReminders.length" class="reminder-status">今天没有额外的重要提醒。</p>
    <div v-else v-for="item in visibleReminders" :key="item.kind+':'+item.id" class="reminder-item">
      <span>{{ item.title }}</span>
      <small>{{ item.dueOn }}</small>
    </div>
  </section>
</template>

<style scoped>
.important-reminders{min-width:0}
.reminder-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.reminder-heading h2{display:flex;align-items:center;gap:8px;margin:0;font-size:16px}
.reminder-item{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:11px 0;border-top:1px solid #e9eee9;min-width:0}
.reminder-item span{overflow-wrap:anywhere;min-width:0}
.reminder-item small{flex:none;color:#6c8073}
.reminder-status{font-size:13px;color:#71867a;margin:8px 0 2px}
.reminder-error{font-size:13px;color:#a45b4c}
@media(max-width:400px){.reminder-item{align-items:flex-start;flex-wrap:wrap}.reminder-item small{margin-left:auto}}
</style>
