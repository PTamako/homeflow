<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue'
import AppIcon from './AppIcon.vue'
import {additionalReminders} from '../today-presentation.mjs'

type Reminder={id:string;kind:string;title:string;dueOn:string}
const props=withDefaults(defineProps<{todayDate:string;todayEntryKeys:string[];compact?:boolean}>(),{compact:false})
const emit=defineEmits<{presenceChange:[hasReminders:boolean]}>()
const items=ref<Reminder[]>([])
const lastLoadedAt=ref(0),loadedDate=ref('')
const loading=ref(false)
const error=ref('')
let requestId=0
const visibleReminders=computed(()=>loadedDate.value===props.todayDate
 ? additionalReminders(items.value,props.todayEntryKeys) as Reminder[] : [])
const pageSize=5,visibleCount=ref(pageSize)
const shownReminders=computed(()=>visibleReminders.value.slice(0,visibleCount.value))

async function load(){
 const current=++requestId
 const date=props.todayDate
 loading.value=true
 error.value=''
 loadedDate.value=''
 try{
  const res=await fetch('/api/reminders?date='+encodeURIComponent(date),{
   credentials:'same-origin',cache:'no-store'})
  if(!res.ok)throw Error('无法读取今天的重要提醒')
  const data=await res.json() as {items?:Reminder[]}
  if(current!==requestId)return
  items.value=data.items||[]
  loadedDate.value=date
 }catch(e){
  if(current!==requestId)return
  items.value=[]
  error.value=(e as Error).message
 }finally{
  if(current===requestId){
    lastLoadedAt.value=Date.now()
    loading.value=false
  }
 }
}
// The badge and menu consume the same in-memory result: no second D1 read.
function refreshIfStale(){
 if(!loading.value&&Date.now()-lastLoadedAt.value>15*60*1000)void load()
}
defineExpose({refreshIfStale})
watch(()=>props.todayDate,()=>{visibleCount.value=pageSize;void load()},{immediate:true})
watch([visibleReminders,loading,error],([rows,isLoading,loadError])=>{
 emit('presenceChange',!isLoading&&!loadError&&rows.length>0)
},{immediate:true})
onBeforeUnmount(()=>{requestId++})
</script>

<template>
  <section :class="['important-reminders',{panel:!compact,compact}]" aria-label="重要提醒">
    <div class="reminder-heading">
      <h2><AppIcon name="bell" :size="20" /> 重要提醒</h2>
      <button v-if="!compact" class="text-button" type="button" :disabled="loading" @click="load">刷新</button>
    </div>
    <p v-if="loading" class="reminder-status" role="status">正在读取今天的提醒…</p>
    <template v-else-if="error">
      <p role="alert" class="reminder-error">{{ error }}</p>
      <button type="button" class="text-button" @click="load">重试</button>
    </template>
    <p v-else-if="!visibleReminders.length" class="reminder-status">今天没有额外的重要提醒。</p>
    <div v-else v-for="item in shownReminders" :key="item.kind+':'+item.id" class="reminder-item">
      <span>{{ item.title }}</span>
      <small>{{ item.dueOn }}</small>
    </div>
    <button v-if="!loading&&!error&&visibleReminders.length>shownReminders.length" type="button"
      class="text-button" @click="visibleCount+=pageSize">加载更多重要提醒（每次 5 条）</button>
  </section>
</template>

<style scoped>
.important-reminders{min-width:0}
.important-reminders.compact{margin:0;padding:0;background:transparent;border:0;box-shadow:none}
.reminder-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.reminder-heading h2{display:flex;align-items:center;gap:8px;margin:0;font-size:16px}
.compact .reminder-heading h2{font-size:14px}
.reminder-item{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:11px 0;border-top:1px solid #e9eee9;min-width:0}
.reminder-item span{overflow-wrap:anywhere;min-width:0}
.reminder-item small{flex:none;color:#6c8073}
.reminder-status{font-size:13px;color:#71867a;margin:8px 0 2px}
.reminder-error{font-size:13px;color:#a45b4c}
@media(max-width:400px){.reminder-item{align-items:flex-start;flex-wrap:wrap}.reminder-item small{margin-left:auto}}
</style>
