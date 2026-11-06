<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue'
import AppIcon from './AppIcon.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
import {additionalReminders} from '../today-presentation.mjs'

type Reminder={id:string;kind:string;title:string;dueOn:string;daysBefore?:number;priority?:'normal'|'important';periodKey?:string;stage?:string;message?:string}
type ItemPreference={kind:string;id:string;advanceDays:number;priority:'normal'|'important'}
type Snooze={id:string;kind:string;untilOn:string}
const shiftDay=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+86400000*n).toISOString().slice(0,10)
const props=withDefaults(defineProps<{todayDate:string;todayEntryKeys:string[];compact?:boolean;mode?:'full'|'list'|'settings'}>(),{compact:false,mode:'full'})
const emit=defineEmits<{presenceChange:[hasReminders:boolean];openPlan:[kind:string,id:string,periodKey:string,done:boolean]}>()
const items=ref<Reminder[]>([])
const lastLoadedAt=ref(0),loadedDate=ref('')
const loading=ref(false)
const error=ref('')
const snoozeError=ref(''),snoozing=ref(false)
const snoozed=ref<Snooze[]>([])
const advanceDays=ref(0),savingAdvance=ref(false)
const quietEnabled=ref(false),quietStart=ref('22'),quietEnd=ref('6')
const itemPreferences=ref<ItemPreference[]>([])
const settingItemKey=ref('')
const savingItem=ref(false)
const prefOf=(item:Reminder)=>itemPreferences.value.find(x=>x.kind===item.kind&&x.id===item.id)
const advanceOf=(item:Reminder)=>prefOf(item)?.advanceDays??advanceDays.value
const priorityOf=(item:Reminder)=>prefOf(item)?.priority||'normal'
const againOn=ref('')
const selectedSnoozeId=ref('')
const tomorrow=computed(()=>shiftDay(props.todayDate,1))
const maxSnoozeDate=computed(()=>shiftDay(props.todayDate,365))
const visibleSnoozes=computed(()=>[...snoozed.value]
  .sort((a,b)=>a.untilOn.localeCompare(b.untilOn)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id))
  .slice(0,5))
const {toast,notify}=usePageToast()
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
  const res=await fetch('/api/reminders?date='+encodeURIComponent(date)+
    (props.mode==='list'?'&pending=1':''),{
   credentials:'same-origin',cache:'no-store'})
  if(!res.ok)throw Error('无法读取今天的重要提醒')
  const data=await res.json() as {items?:Reminder[];advanceDays?:number;snoozed?:Snooze[];quietHours?:{start:number|null;end:number|null};itemPreferences?:ItemPreference[]}
  if(current!==requestId)return
  items.value=data.items||[]
  snoozed.value=data.snoozed||[]
  advanceDays.value=[0,1,3,7].includes(data.advanceDays||0)?data.advanceDays||0:0
  itemPreferences.value=data.itemPreferences||[]
  quietEnabled.value=data.quietHours?.start!=null&&data.quietHours.end!=null
  if(quietEnabled.value){
   quietStart.value=String(data.quietHours!.start)
   quietEnd.value=String(data.quietHours!.end)
  }
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
async function snooze(item:Reminder,againDate?:string){
 if(snoozing.value)return
 const untilOn=againDate?shiftDay(againDate,-1):props.todayDate
 snoozing.value=true;snoozeError.value=''
 try{
  const response=await fetch('/api/reminders/snooze',{
   method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({kind:item.kind,id:item.id,untilOn})
  })
  if(!response.ok)throw Error('稍后提醒保存失败，请重试')
  items.value=items.value.filter(x=>x.kind!==item.kind||x.id!==item.id)
  snoozed.value=snoozed.value.filter(x=>x.kind!==item.kind||x.id!==item.id)
  snoozed.value.unshift({kind:item.kind,id:item.id,untilOn})
  selectedSnoozeId.value='';againOn.value=''
  notify(againDate?'已设置指定日期再提醒':'已设置明天再提醒')
 }catch(e){snoozeError.value=(e as Error).message}
 finally{snoozing.value=false}
}
async function cancelSnooze(item:Snooze){
 if(snoozing.value)return
 snoozing.value=true;snoozeError.value=''
 try{
  const response=await fetch('/api/reminders/snooze',{
   method:'DELETE',credentials:'same-origin',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({kind:item.kind,id:item.id})
  })
  if(!response.ok)throw Error('取消延后失败')
  await load()
  notify('已恢复正常提醒')
 }catch(e){snoozeError.value=(e as Error).message}
 finally{snoozing.value=false}
}
async function saveLead(value:string){
 const days=Number(value)
 if(savingAdvance.value||![0,1,3,7].includes(days))return
 savingAdvance.value=true;snoozeError.value=''
 try{
  const res=await fetch('/api/reminders/preferences',{
   method:'PUT',credentials:'same-origin',
   headers:{'content-type':'application/json'},body:JSON.stringify({advanceDays:days})
  })
  if(!res.ok)throw Error('提前提醒设置失败')
  advanceDays.value=days
  await load()
  notify('提前提醒设置已保存')
 }catch(e){snoozeError.value=(e as Error).message}
 finally{savingAdvance.value=false}
}
async function saveQuiet(){
 const start=Number(quietStart.value),end=Number(quietEnd.value)
 if(quietEnabled.value&&(!Number.isInteger(start)||!Number.isInteger(end)||
    start<0||start>23||end<0||end>23||start===end)){
  snoozeError.value='安静时段的开始与结束小时不能相同';return
 }
 if(savingAdvance.value)return
 savingAdvance.value=true;snoozeError.value=''
 try{
  const res=await fetch('/api/reminders/preferences',{
   method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},
   body:JSON.stringify({advanceDays:advanceDays.value,
    quietStartHour:quietEnabled.value?start:null,quietEndHour:quietEnabled.value?end:null})
  })
  if(!res.ok)throw Error('安静时段保存失败')
  await load()
  notify('安静时段已保存')
 }catch(e){snoozeError.value=(e as Error).message}
 finally{savingAdvance.value=false}
}
async function saveItem(item:Reminder,days:number,priority:'normal'|'important',reset=false){
 if(savingItem.value)return
 savingItem.value=true;snoozeError.value=''
 try{
  const res=await fetch('/api/reminders/item',{
   method:reset?'DELETE':'PUT',credentials:'same-origin',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({kind:item.kind,id:item.id,advanceDays:days,priority})
  })
  if(!res.ok)throw Error('单项提醒设置失败')
  await load()
  settingItemKey.value=''
  notify(reset?'已恢复账号默认提醒':'单项提醒设置已保存')
 }catch(e){snoozeError.value=(e as Error).message}
 finally{savingItem.value=false}
}
// The badge and menu consume the same in-memory result: no second D1 read.
function refreshIfStale(){
 if(!loading.value&&Date.now()-lastLoadedAt.value>15*60*1000)void load()
}
defineExpose({refreshIfStale,refresh:load})
watch(()=>props.todayDate,()=>{visibleCount.value=pageSize;void load()},{immediate:true})
watch([visibleReminders,loading,error],([rows,isLoading,loadError])=>{
 emit('presenceChange',!isLoading&&!loadError&&rows.length>0)
},{immediate:true})
onBeforeUnmount(()=>{requestId++})
</script>

<template>
  <section :class="['important-reminders',{panel:!compact,compact}]" :aria-label="mode==='settings'?'提醒规则':'待提醒'">
    <div v-if="mode==='full'" class="reminder-heading">
      <h2><AppIcon name="bell" :size="20" /> 重要提醒</h2>
      <button v-if="!compact" class="text-button" type="button" :disabled="loading" @click="load">刷新</button>
    </div>
    <template v-if="mode!=='settings'">
    <p v-if="loading" class="reminder-status" role="status">正在读取待提醒事项…</p>
    <template v-else-if="error">
      <p role="alert" class="reminder-error">{{ error }}</p>
      <button type="button" class="text-button" @click="load">重试</button>
    </template>
    <p v-else-if="!visibleReminders.length" class="reminder-status">暂无待提醒事项</p>
    <div v-else v-for="item in shownReminders" :key="item.kind+':'+item.id" class="reminder-item">
      <div class="reminder-details">
       <div class="reminder-title">
        <strong>{{ item.title }}</strong>
        <span v-if="item.daysBefore" class="reminder-lead">提前 {{ item.daysBefore }} 天</span>
        <span v-if="item.priority==='important'" class="reminder-priority">重要</span>
       </div>
       <time class="reminder-date" :datetime="item.dueOn">截止 {{ item.dueOn }}</time>
       <small v-if="item.kind==='goal'&&item.message" class="reminder-message">{{ item.message }}</small>
      </div>
      <div v-if="item.kind==='goal'" class="snooze-actions">
       <button type="button" class="snooze-button" @click="emit('openPlan','goal',item.id,item.periodKey||'once',false)">去处理</button>
      </div>
      <div v-else class="snooze-actions">
       <button class="snooze-button" type="button" :disabled="snoozing"
        @click="snooze(item)">明天</button>
       <button class="snooze-button" type="button" :disabled="snoozing"
        @click="selectedSnoozeId=selectedSnoozeId===item.kind+':'+item.id?'':item.kind+':'+item.id;againOn=tomorrow">选日期</button>
       <button v-if="['task','routine','shopping','trip'].includes(item.kind)" class="snooze-button" type="button"
        @click="settingItemKey=settingItemKey===item.kind+':'+item.id?'':item.kind+':'+item.id">单项设置</button>
       <div v-if="settingItemKey===item.kind+':'+item.id" class="snooze-calendar item-settings">
        <label>提前<select :value="String(advanceOf(item))" :disabled="savingItem"
         @change="saveItem(item,Number(($event.target as HTMLSelectElement).value),priorityOf(item))">
         <option value="0">当天</option><option value="1">1 天</option><option value="3">3 天</option><option value="7">7 天</option>
        </select></label>
        <label>级别<select :value="priorityOf(item)" :disabled="savingItem"
         @change="saveItem(item,advanceOf(item),($event.target as HTMLSelectElement).value as 'normal'|'important')">
         <option value="normal">普通</option><option value="important">重要</option>
        </select></label>
        <button v-if="prefOf(item)" type="button" :disabled="savingItem" @click="saveItem(item,advanceDays,'normal',true)">重置</button>
       </div>
       <div v-if="selectedSnoozeId===item.kind+':'+item.id" class="snooze-calendar">
        <input v-model="againOn" type="date" :min="tomorrow" :max="maxSnoozeDate" aria-label="重新提醒日期"/>
        <button type="button" :disabled="snoozing||!againOn||againOn<tomorrow||againOn>maxSnoozeDate"
         @click="snooze(item,againOn)">保存</button>
       </div>
      </div>
    </div>
    </template>
    <div v-if="mode!=='list'" class="reminder-settings">
      <label>默认提前提醒
       <select :value="String(advanceDays)" :disabled="savingAdvance" @change="saveLead(($event.target as HTMLSelectElement).value)">
        <option value="0">到期当天</option><option value="1">提前 1 天</option>
        <option value="3">提前 3 天</option><option value="7">提前 7 天</option>
       </select>
      </label>
      <div class="quiet-controls">
       <label class="quiet-toggle"><input v-model="quietEnabled" type="checkbox"/> 启用推送安静时段</label>
       <div v-if="quietEnabled" class="quiet-hours">
        <label>开始<select v-model="quietStart"><option v-for="hour in 24" :key="hour-1" :value="String(hour-1)">{{ String(hour-1).padStart(2,'0') }}:00</option></select></label>
        <label>结束<select v-model="quietEnd"><option v-for="hour in 24" :key="hour-1" :value="String(hour-1)">{{ String(hour-1).padStart(2,'0') }}:00</option></select></label>
       </div>
       <button class="snooze-button" type="button" :disabled="savingAdvance" @click="saveQuiet">保存安静时段</button>
       <small>每日 06:00 推送，安静时段不通知。</small>
      </div>
    </div>
    <div v-if="mode!=='list'&&snoozed.length" class="snoozed-items">
      <b>已延后的提醒</b>
      <div v-for="item in visibleSnoozes" :key="item.kind+':'+item.id" class="snoozed-row">
       <span>{{ item.kind==='task'?'任务':item.kind==='routine'?'定期事项':item.kind==='trip'?'旅行':'纪念日' }}
        · {{ shiftDay(item.untilOn,1) }} 再提醒</span>
       <button type="button" :disabled="snoozing" @click="cancelSnooze(item)">取消延后</button>
      </div>
    </div>
    <p v-if="snoozeError" class="reminder-error" role="alert">{{ snoozeError }}</p>
    <PageToast :toast="toast" />
    <button v-if="mode!=='settings'&&!loading&&!error&&visibleReminders.length>shownReminders.length" type="button"
      class="text-button" @click="visibleCount+=pageSize">加载更多</button>
  </section>
</template>

<style scoped>
.important-reminders{min-width:0}
.important-reminders.compact{margin:0;padding:0;background:transparent;border:0;box-shadow:none}
.reminder-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.reminder-heading h2{display:flex;align-items:center;gap:8px;margin:0;font-size:16px}
.compact .reminder-heading h2{font-size:14px}
/* Each reminder gets a full-width details row and its own action row on phones. */
.reminder-item{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;
  padding:13px 0;border-top:1px solid #e9eee9;min-width:0}
.reminder-details{display:grid;gap:5px;min-width:0}
.reminder-title{display:flex;align-items:center;flex-wrap:wrap;gap:5px 8px;min-width:0}
.reminder-title strong{font-size:14px;font-weight:600;min-width:0;overflow-wrap:anywhere}
.reminder-lead,.reminder-priority{flex:none;font-size:11px;color:#557b65;background:#edf5ee;
  padding:3px 7px;border-radius:6px;white-space:nowrap}
.reminder-priority{color:#a25944;background:#fff2e9}
.reminder-date{font-size:12px;color:#708378;white-space:nowrap}
.reminder-message{color:#617f6a;font-size:11px;line-height:1.5}
.snooze-button{font-size:12px;white-space:nowrap;background:#edf4ee;color:#3d7b5d;
  border:1px solid #d8e7da;border-radius:8px;padding:7px 11px;min-height:34px}
.snooze-button:disabled{opacity:.5}
.snooze-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;min-width:0}
.snooze-calendar{display:flex;gap:7px;flex:1 0 100%;align-items:center;min-width:0}
.snooze-calendar input{min-width:0;max-width:180px;flex:1;border:1px solid #d5e3d8;border-radius:8px;padding:6px}
.item-settings{align-items:flex-end;flex-wrap:wrap}
.item-settings label{display:grid;gap:3px;font-size:11px}
.item-settings select{border:1px solid #d5e3d8;border-radius:8px;padding:5px;min-height:30px;max-width:100%}
.quiet-controls{display:grid;gap:7px;border-top:1px solid #e3eee6;margin-top:8px;padding-top:9px}
.quiet-controls .quiet-toggle{display:flex;align-items:center;gap:6px}
.quiet-hours{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.quiet-hours select{width:100%;border:1px solid #d5e3d8;border-radius:8px;padding:6px;background:white}
.quiet-controls>.snooze-button{justify-self:start}
.reminder-settings{margin-top:8px;border-top:1px solid #e7eee9;padding-top:8px}
.reminder-settings label{font-size:12px;display:grid;gap:5px}
.reminder-settings select{min-height:34px;width:100%;border-radius:8px;border:1px solid #d5e3d8;background:white}
.reminder-settings small{color:#71867a;font-size:11px}
.snoozed-items{padding-top:8px}
.snoozed-items>b{font-size:12px}
.snoozed-row{display:flex;justify-content:space-between;gap:6px;align-items:center;padding:5px 0;border-top:1px solid #e8eee9;font-size:11px}
.snoozed-row>span{min-width:0;overflow-wrap:anywhere}
.snoozed-row button{flex:none;background:transparent;border:1px solid #dee8e1;border-radius:7px;padding:5px;color:#527964}
.reminder-status{font-size:13px;color:#71867a;margin:8px 0 2px}
.reminder-error{font-size:13px;color:#a45b4c}
@media(max-width:360px){.snooze-button{padding-inline:8px}}
</style>
