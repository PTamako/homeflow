<script setup lang="ts">
import {nextTick,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ImportantReminders from './ImportantReminders.vue'
import {notificationStatus,notificationTitle,notificationMessageRemainder} from '../notification-status.mjs'

type Notice={
 id:string;kind:'task'|'routine'|'shopping'|'family'|'system';sourceId:string|null;dedupeKey:string|null;
 title:string;message:string;deliveryStatus:'sent'|'partial'|'failed';
 sentDevices:number;failedDevices:number;createdAt:string;readAt:string|null;
 senderUserId:string|null;recipientUserId:string;senderName:string;recipientName:string
}
const props=defineProps<{active:boolean;todayDate:string;userId:string;todayEntryKeys:string[];
 memberProfiles:Array<{memberUserId:string|null;displayName:string}>;
 focusNotificationId:string;focusRequest:number}>()
const emit=defineEmits<{unreadChange:[number];openPlan:[string,string,string,boolean];focusHandled:[string]}>()
const expanded=ref(false),view=ref<'pending'|'received'|'sent'>('received')
const notices=ref<Notice[]>([]),cursor=ref<string|null>(null),unread=ref(0)
const loading=ref(false),moreBusy=ref(false),error=ref(''),reading=ref<string|null>(null)
const highlightedId=ref('')
const pendingReminders=ref<{refresh:()=>Promise<void>|void}|null>(null)
let generation=0
function timeOf(value:string|null){
 if(!value)return ''
 const iso=value.includes('T')?value:value.replace(' ','T')+'Z'
 const n=Date.parse(iso)
 return Number.isFinite(n)?new Intl.DateTimeFormat('zh-CN',{
   timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false
 }).format(new Date(n)):''
}
function detail(item:Notice){
 if(item.readAt)return (view.value==='sent'?'对方已读 ':'已读 ')+timeOf(item.readAt)
 return view.value==='sent'?'对方未读':'未读'
}
function deliveryDetail(item:Notice){
 if(item.sentDevices===0)return '仅应用内'
 return item.failedDevices>0?'部分推送成功':'已推送'
}
// Resolve notification participants from the household's existing linked profiles.
// Keep login emails out of the UI and avoid extra D1 queries for each notice.
// The existing inbox kind CHECK stays unchanged. A goal notice is a system
// notification whose server-generated identity embeds the exact goal/period.
function wishTarget(item:Notice){
 if(item.kind!=='system'||!item.sourceId||!item.dedupeKey)return null
 const match=/^scheduled:wish:([0-9a-f-]{36}):[0-9]{4}-[0-9]{2}-[0-9]{2}:(?:0|1|3|7)$/.exec(item.dedupeKey)
 return match&&match[1]===item.sourceId?{id:match[1]}:null
}
function savingsTarget(item:Notice){
 if(item.kind!=='system'||!item.sourceId||!item.dedupeKey)return null
 const match=/^scheduled:goal:([0-9a-f-]{36}):(once|[0-9]{4}(?:-[0-9]{2})?):(due|advance|pending|result):[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]+$/.exec(item.dedupeKey)
 if(!match||match[1]!==item.sourceId)return null
 return {id:match[1],periodKey:match[2]}
}
function memberDisplayName(userId:string|null){
 if(!userId)return '系统提醒'
 const profile=props.memberProfiles.find(p=>p.memberUserId===userId)
 return profile?.displayName?.trim()||'未设置姓名'
}
async function load(reset=true,focusId=''):Promise<boolean>{
 if(!props.active)return false
 const request=++generation,day=props.todayDate
 if(reset){loading.value=true;error.value='';cursor.value=null}
 else moreBusy.value=true
 try{
  const params=new URLSearchParams({view:view.value==='pending'?'received':view.value})
  if(!reset&&cursor.value)params.set('before',cursor.value)
  if(reset&&focusId&&view.value==='received')params.set('focus',focusId)
  const response=await fetch('/api/notifications/today?'+params,{
    credentials:'same-origin',cache:'no-store'
  })
  if(!response.ok)throw Error('通知读取失败')
  const data=await response.json()
  if(request!==generation||day!==props.todayDate)return false
  if(view.value!=='pending'){
   const items:Notice[]=data.items||[]
   if(reset){
    const focused=data.focusItem as Notice|null
    notices.value=focused&&!items.some(item=>item.id===focused.id)?[focused,...items]:items
    highlightedId.value=focusId
   }else{
    const existing=new Set(notices.value.map(item=>item.id))
    notices.value=[...notices.value,...items.filter(item=>!existing.has(item.id))]
   }
   cursor.value=data.nextCursor||null
  }
  unread.value=Math.max(0,Number(data.unreadCount)||0)
  emit('unreadChange',unread.value)
  // Push arriving while the pending tab is open should immediately remove delivered items.
  if(view.value==='pending')await pendingReminders.value?.refresh()
  return true
 }catch(e){
  if(request===generation)error.value=(e as Error).message
  return false
 }finally{
  if(request===generation){loading.value=false;moreBusy.value=false}
 }
}
async function changeReadState(item:Notice,markAsRead:boolean){
 if(item.recipientUserId!==props.userId||reading.value||
   (markAsRead?!!item.readAt:!item.readAt))return
 reading.value=item.id
 error.value=''
 try{
  const endpoint=markAsRead?'read':'unread'
  const r=await fetch('/api/notifications/'+encodeURIComponent(item.id)+'/'+endpoint,{
   method:'POST',credentials:'same-origin',cache:'no-store'
  })
  if(!r.ok)throw Error(markAsRead?'标记已读失败':'标记未读失败')
  const data=await r.json()
  item.readAt=markAsRead?new Date().toISOString():null
  unread.value=Math.max(0,Number(data.unreadCount)||0)
  // One source of truth for Today's red dot and the Home Screen PWA badge.
  emit('unreadChange',unread.value)
 }catch(e){error.value=(e as Error).message}
 finally{reading.value=null}
}
async function markRead(item:Notice){await changeReadState(item,true)}
async function markUnread(item:Notice){await changeReadState(item,false)}
async function open(item:Notice){
 if(view.value==='received')await markRead(item)
 if(item.sourceId&&['task','routine','shopping'].includes(item.kind)){
   const done=item.message.startsWith('已完成 · ')
   const period=done&&item.kind==='routine'
     ?item.message.match(/ · (\d{4}-\d{2}-\d{2})$/)?.[1]||'':''
   emit('openPlan',item.kind,item.sourceId,period,done)
 }else{
   const goal=savingsTarget(item)
   if(goal)emit('openPlan','goal',goal.id,goal.periodKey,false)
   else {
     const wish=wishTarget(item)
     if(wish)emit('openPlan','wish',wish.id,'',false)
   }
 }
}
async function showIncomingNotification(id:string){
 if(!props.active||!/^[a-f0-9-]{36}$/i.test(id))return
 expanded.value=true
 view.value='received'
 let readFailed=false
 try{
  const response=await fetch('/api/notifications/'+encodeURIComponent(id)+'/read',{
   method:'POST',credentials:'same-origin',cache:'no-store'
  })
  if(!response.ok)throw Error('自动标记已读失败')
  const result=await response.json()
  unread.value=Math.max(0,Number(result.unreadCount)||0)
  emit('unreadChange',unread.value)
 }catch{readFailed=true}
 await load(true,id)
 if(readFailed)error.value='自动标记已读失败，请手动标记'
 emit('focusHandled',id)
 await nextTick()
 document.getElementById('today-notification-'+id)?.scrollIntoView({block:'center',behavior:'smooth'})
}
watch(()=>[props.todayDate,props.userId,props.active],()=>{void load(true)},{immediate:true})
watch(()=>[props.focusRequest,props.active],()=>{
 if(props.active&&props.focusRequest>0&&props.focusNotificationId)
  void showIncomingNotification(props.focusNotificationId)
},{immediate:true})
watch(view,()=>{if(view.value!=='pending')void load(true)})
defineExpose({refresh:()=>load(true)})
</script>

<template>
 <section class="panel today-notifications" aria-label="今日通知">
  <div class="notice-heading">
   <button type="button" class="notice-expand" :aria-expanded="expanded" @click="expanded=!expanded">
    <span v-if="unread>0" class="notice-red-dot" aria-hidden="true"></span>
    <AppIcon name="bell" :size="19"/>
    <b>今日通知</b>
    <span v-if="unread>0" class="notice-unread-count">{{ unread }} 条未读</span>
   </button>
   <button type="button" class="notice-text-button" @click="expanded=!expanded">{{ expanded?'收起':'查看' }}</button>
  </div>
  <div v-if="expanded" class="notice-content">
   <div class="notice-tabs" role="group" aria-label="通知分类">
    <button type="button" :aria-pressed="view==='pending'" :class="{active:view==='pending'}"
      @click="view='pending'">待提醒</button>
    <button type="button" :aria-pressed="view==='received'" :class="{active:view==='received'}"
      @click="view='received'">我收到的</button>
    <button type="button" :aria-pressed="view==='sent'" :class="{active:view==='sent'}"
      @click="view='sent'">我发送的</button>
   </div>
   <div v-if="view==='pending'" class="notice-reminder-list">
    <ImportantReminders :today-date="todayDate" :today-entry-keys="todayEntryKeys"
      compact mode="list" ref="pendingReminders"
      @open-plan="(kind,id,periodKey,done)=>emit('openPlan',kind,id,periodKey,done)" />
   </div>
   <template v-else>
   <p v-if="loading" class="notice-muted" role="status">正在读取…</p>
   <p v-else-if="error" class="notice-error" role="alert">{{ error }} <button type="button" @click="load(true)">重试</button></p>
   <p v-else-if="!notices.length" class="notice-empty">今天暂无通知</p>
   <div v-for="item in notices" :id="'today-notification-'+item.id" :key="item.id"
     :class="['notice-item',{'notice-focused':highlightedId===item.id}]">
    <div class="notice-item-top">
     <div class="notice-item-heading">
      <b>{{ notificationTitle(item) }}</b>
      <span v-if="notificationStatus(item)"
        :class="['notice-task-status','notice-task-status-'+notificationStatus(item)?.tone]">
       {{ notificationStatus(item)?.label }}
      </span>
     </div>
     <span :class="['notice-state',{'notice-state-unread':!item.readAt}]">
      {{ detail(item) }}
     </span>
    </div>
    <p v-if="item.message">
     <template v-if="notificationStatus(item)">
      <strong :class="['notice-message-status','notice-message-status-'+notificationStatus(item)?.tone]">{{ notificationStatus(item)?.label }}</strong>{{ notificationMessageRemainder(item) }}
     </template>
     <template v-else>{{ item.message }}</template>
    </p>
    <div class="notice-bottom">
     <small>{{ view==='sent'?'发送给：'+memberDisplayName(item.recipientUserId):'来自：'+memberDisplayName(item.senderUserId) }} · {{ timeOf(item.createdAt) }}<template v-if="view==='sent'"> · {{ deliveryDetail(item) }}</template></small>
     <div class="notice-item-actions">
      <button v-if="view==='received'&&!item.readAt"
        type="button" :disabled="!!reading" @click="markRead(item)">标记已读</button>
      <button v-if="view==='received'&&item.readAt"
        type="button" :disabled="!!reading" @click="markUnread(item)">标记未读</button>
      <button v-if="item.sourceId&&(['task','routine','shopping'].includes(item.kind)||savingsTarget(item)||wishTarget(item))"
        type="button" @click="open(item)">{{ savingsTarget(item)?'查看储值':wishTarget(item)?'查看心愿':'查看计划' }}</button>
     </div>
    </div>
   </div>
   <button v-if="cursor&&!loading" type="button" class="notice-more"
    :disabled="moreBusy" @click="load(false)">{{ moreBusy?'读取中…':'加载更多' }}</button>
   </template>
  </div>
 </section>
</template>
<style scoped>
.today-notifications{margin:12px 0;padding:15px 18px;min-width:0}
.notice-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
.notice-expand{display:flex;align-items:center;gap:9px;min-width:0;padding:0;border:0;background:transparent;color:#304a3c;font-size:15px}
.notice-expand b{white-space:nowrap}
.notice-text-button,.notice-item-actions button,.notice-more{padding:5px 8px;border:0;background:transparent;color:#43866a;font-size:12px;font-weight:600}
.notice-red-dot{width:8px;height:8px;min-width:8px;border-radius:50%;background:#c83e48;flex:none}
.notice-unread-count{color:#9a6568;font-size:11px;white-space:nowrap}
.notice-muted{font-size:12px;color:#8a998f}
.notice-content{padding-top:13px}
.notice-tabs{display:flex;gap:8px;margin-bottom:4px;flex-wrap:wrap}
.notice-reminder-list{padding-top:5px}
.notice-tabs button{background:#f5f8f5;border:1px solid #dfebe2;border-radius:9px;padding:6px 12px;font-size:12px;color:#60766a}
.notice-tabs button.active{background:#e6f1e9;color:#35795e;border-color:#b7d7c3;font-weight:700}
.notice-item{padding:12px 0;border-top:1px solid #edf1ec;scroll-margin-top:24px}
.notice-item.notice-focused{background:#f2f8f2;border-radius:9px;padding:12px 9px}
.notice-item-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.notice-item-heading{display:flex;align-items:center;gap:6px;min-width:0;flex:1;flex-wrap:wrap}
.notice-item-heading b{font-size:13px;overflow-wrap:anywhere}
.notice-task-status{display:inline-flex;align-items:center;flex:none;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700;line-height:1.3}
.notice-task-status-completed{color:#216e4a;background:#e5f4ea}
.notice-task-status-deferred{color:#276ca5;background:#e8f2fc}
.notice-task-status-pending{color:#925b15;background:#fff2d8}
.notice-task-status-skipped{color:#68766d;background:#eef1ee}
.notice-message-status{font-weight:700}
.notice-message-status-completed{color:#216e4a}
.notice-message-status-deferred{color:#276ca5}
.notice-message-status-pending{color:#925b15}
.notice-message-status-skipped{color:#68766d}
.notice-state{white-space:nowrap;color:#7a8e80;font-size:11px}
.notice-state-unread{color:#b33e44;font-weight:700}
.notice-item p{font-size:12px;color:#56695d;line-height:1.6;margin:6px 0}
.notice-bottom{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
.notice-bottom small{font-size:11px;color:#89988d}
.notice-item-actions{display:flex;gap:3px}
.notice-empty{text-align:center;color:#91a097;font-size:12px;padding:20px 0 8px}
.notice-error{font-size:12px;color:#a24e38}
.notice-more{display:block;margin:8px auto}
</style>