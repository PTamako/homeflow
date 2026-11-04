<script setup lang="ts">
import DateField from './DateField.vue'
import {computed,ref,watch,onBeforeUnmount,onMounted} from 'vue'
import {listLocalPhotos,saveLocalPhoto,downloadLocalPhoto,compressPhoto} from '../local-media'
import {anniversaryMilestoneLabel} from '../anniversary-milestones.mjs'
import {upcomingWithinDays} from '../today-presentation.mjs'
import FinancePanel from './FinancePanel.vue'
import PlanCreator from './PlanCreator.vue'
import AppIcon from './AppIcon.vue'
import LifeItemEditor from './LifeItemEditor.vue'
import ShoppingLedgerPicker from './ShoppingLedgerPicker.vue'
import SwipeActions from './SwipeActions.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'

const props=defineProps<{mode:'today'|'family'|'plans'|'memories';userId:string;isOwner:boolean;profileRevision:number;profiles:Array<{id:string;displayName:string;type:string;memberUserId?:string|null}>;tasks?:Record<string,any>[];focusPlanType?:string}>()
const emit=defineEmits<{editProfile:[id:string];tasksChanged:[];openPlans:[kind:string]}>()
const {toast,notify,clear:clearToast}=usePageToast()
watch(()=>props.mode,clearToast)
type Row=Record<string,any>
const items=ref<Row[]>([]),other=ref<Row[]>([]),goals=ref<Row[]>([]),trips=ref<Row[]>([]),routines=ref<Row[]>([])
const error=ref(''),busy=ref(false)
const listLoading=ref(false)
let activeFetch=0
type PlanType='all'|'routine'|'shopping'|'wish'|'goal'|'trip'
const planType=ref<PlanType>('all')
const financeDetail=ref<{kind:'goal'|'trip';id:string}|null>(null)
const onceEditing=ref<Row|null>(null)
const onceTitle=ref(''),onceDate=ref(''),onceRemind=ref(true)
const eventTitle=ref(''),eventDate=ref(''),eventRepeat=ref('yearly')
const routineTitle=ref(''),routineRepeat=ref('daily'),intervalDays=ref(30),intervalAnchor=ref('fixed'),routineSubject=ref(''),routineHealthType=ref('')
const wishTitle=ref(''),wishType=ref('trip'),wishBudget=ref(0),wishVisibility=ref('household')
const goalTitle=ref(''),goalAmount=ref(100000),goalTarget=ref('')
const shoppingTitle=ref('')
const displayedDay=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,10))
const todayAnniversaries=computed<Row[]>(()=>upcomingWithinDays(items.value,displayedDay.value,30))
type EditableKind='routines'|'anniversaries'|'wishes'|'goals'|'shopping'|'memories'|'trips'
const editing=ref<{kind:EditableKind;item:Row}|null>(null),ledgerPickerId=ref<string|null>(null)
const canEdit=(item:Row)=>item.created_by===props.userId||item.createdBy===props.userId||item.creatorUserId===props.userId
const canEditBirthday=(item:Row)=>{
  if(item.source!=='profile_birthday')return false
  const profile=props.profiles.find(p=>p.id===item.subject_profile_id)
  return !!profile&&(props.isOwner||profile.memberUserId===props.userId)
}
function editAnniversary(item:Row){
  if(item.source==='profile_birthday'){
    if(canEditBirthday(item))emit('editProfile',item.subject_profile_id)
  }else edit('anniversaries',item)
}
function edit(kind:EditableKind,item:Row){editing.value=editing.value?.item.id===item.id?null:{kind,item};ledgerPickerId.value=null}
async function changed(){editing.value=null;ledgerPickerId.value=null;await fetchMode();if(!error.value)notify('修改已保存')}
async function removeItem(kind:EditableKind,item:Row){
 if(!canEdit(item))return
 const warning=kind==='memories'?'删除回忆后，本机照片不会一起删除，请先备份。':
   kind==='routines'?'删除定期计划？以前的完成记录会保留。':'确定删除这条记录吗？'
 if(!confirm(warning))return
 await update(()=>api('/'+kind+'/'+item.id,'DELETE'),'已删除')
 if(!error.value){editing.value=null;if(kind==='trips'&&tripDetail.value?.id===item.id)tripDetail.value=null}
}
const jstDate=(timestamp:string)=>{
 const iso=timestamp.includes('T')?timestamp:timestamp.replace(' ','T')+'Z'
 const time=Date.parse(iso)
 return Number.isFinite(time)?new Date(time+9*3600000).toISOString().slice(0,10):''
}
const planScope=ref<'active'|'history'>('active')
// Task history is independently paginated; the dashboard task snapshot is not an archive.
const oneTimePlans=ref<Row[]>([])
function linkedGoal(w:Row){return goals.value.find(g=>g.wish_id===w.id)}
function toggleFinance(kind:'goal'|'trip',id:string){
  financeDetail.value=financeDetail.value?.kind===kind&&financeDetail.value.id===id?null:{kind,id}
}
async function planCreated(kind:PlanType,id:string){
  planType.value=kind
  await fetchMode()
  notify('计划已创建'+(kind==='wish'?'，如已选择储值计划则自动关联':''))
}
function editOnce(t:Row){
  onceEditing.value=onceEditing.value?.id===t.id?null:t
  onceTitle.value=t.title;onceDate.value=t.dueOn||'';onceRemind.value=t.remindEnabled!==0
}
async function onceChange(t:Row,payload:Record<string,unknown>,method='PATCH'){
  await update(()=>api('/tasks/'+t.id,method,payload),method==='DELETE'?'已删除':'已保存')
  emit('tasksChanged')
}
async function saveOnce(){
  const t=onceEditing.value
  if(!t)return
  await onceChange(t,{title:onceTitle.value,notes:t.notes||'',visibility:t.visibility,
    dueOn:onceDate.value||null,assigneeUserId:t.assigneeUserId||null,
    subjectProfileId:t.subjectProfileId||null,healthRecordType:t.healthRecordType||null,
    remindEnabled:onceRemind.value,expectedUpdatedAt:t.updatedAt})
  if(!error.value)onceEditing.value=null
}
async function deleteOnce(t:Row){
  if(!confirm('删除这项一次性计划吗？'))return
  await onceChange(t,{},'DELETE')
}
watch(()=>props.focusPlanType,type=>{
  if(['routine','shopping','wish','goal','trip'].includes(type||''))planType.value=type as PlanType
})

const planYear=ref(''),planMonth=ref('')
const memoryYear=ref(''),memoryMonth=ref('')
const yearOptions=Array.from({length:16},(_,i)=>String(new Date().getFullYear()-i))
const monthOptions=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))
const listCursors=ref<Record<string,string|null>>({})
const pageBusy=ref<Record<string,boolean>>({})
const pageLimit=6
const anniversaryExpanded=ref(false)
const anniversaryView=ref<'upcoming'|'past'>('upcoming')
const anniversaryYear=ref(''),anniversaryMonth=ref('')
const upcomingAnniversaries=computed(()=>anniversaryView.value==='past'?items.value:
  anniversaryExpanded.value?items.value:items.value.slice(0,5))
const visibleShopping=computed(()=>other.value)

function listPath(kind:string,cursor?:string|null){
  const q=new URLSearchParams({limit:String(pageLimit)})
  if(kind==='memories'){
    if(memoryYear.value){q.set('year',memoryYear.value);if(memoryMonth.value)q.set('month',memoryMonth.value)}
  }else if(kind==='anniversaries'){
    q.set('scope','history')
    if(anniversaryYear.value){
      q.set('year',anniversaryYear.value)
      if(anniversaryMonth.value)q.set('month',anniversaryMonth.value)
    }
  }else{
    q.set('scope',planScope.value)
    if(planScope.value==='history'&&planYear.value){
      q.set('year',planYear.value);if(planMonth.value)q.set('month',planMonth.value)
    }
  }
  if(cursor)q.set('cursor',cursor)
  return '/'+kind+'?'+q.toString()
}
function assignRows(kind:string,rows:Row[],append=false){
  const target=kind==='tasks'?oneTimePlans:kind==='wishes'||kind==='memories'||kind==='anniversaries'?items:
    kind==='goals'?goals:kind==='shopping'?other:kind==='trips'?trips:routines
  target.value=append?[...target.value,...rows]:rows
}
async function loadMore(kind:string){
  const cursor=listCursors.value[kind]
  if(!cursor||pageBusy.value[kind])return
  const endpoint=listPath(kind,cursor)
  pageBusy.value[kind]=true
  try{
    const data=await api(endpoint)
    // Ignore responses for a filter that changed while the request was running.
    if(endpoint!==listPath(kind,cursor)||
      (kind==='memories'&&props.mode!=='memories')||
      (kind==='anniversaries'&&(props.mode!=='family'||anniversaryView.value!=='past'))||
      (kind!=='memories'&&kind!=='anniversaries'&&props.mode!=='plans'))return
    assignRows(kind,data.items||[],true)
    listCursors.value[kind]=data.nextCursor||null
    if(kind==='memories')await loadPhotos()
  }catch(e){error.value=(e as Error).message}
  finally{pageBusy.value[kind]=false}
}

function toggleLedger(id:string){ledgerPickerId.value=ledgerPickerId.value===id?null:id;editing.value=null}

function milestone(item:Row){return anniversaryMilestoneLabel(item,displayedDay.value)}
function countdown(date:string){
  const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000)
  if(!Number.isFinite(days))return ''
  return days<=0?'今天':days===1?'明天 · 倒计时 1 天':'倒计时 '+days+' 天'
}
function routineNextDue(r:Row){
  if(r.repeat_type!=='interval')return ''
  let config:Record<string,any>={}
  try{config=typeof r.repeat_config==='string'?JSON.parse(r.repeat_config):r.repeat_config||{}}catch{return ''}
  if(config.anchor!=='completion'||!Number.isInteger(config.days)||config.days<1||config.days>3650)return ''
  if(r.next_due_on)return String(r.next_due_on)
  const timestamp=Date.parse(String(r.anchor_date||'')+'T00:00:00Z')
  return Number.isFinite(timestamp)?new Date(timestamp+config.days*86400000).toISOString().slice(0,10):''
}
function canCompleteRoutineEarly(r:Row){
  const next=routineNextDue(r),date=today()
  if(!next||r.enabled===0||date<String(r.anchor_date||'')||date>=next)return false
  // The stored next_due_on is completion-based. Once a completion is
  // recorded today, don't offer a second early-complete button.
  if(r.next_due_on){
    let config:Record<string,any>={}
    try{config=typeof r.repeat_config==='string'?JSON.parse(r.repeat_config):r.repeat_config||{}}catch{return false}
    const dueMs=Date.parse(next+'T00:00:00Z')
    if(new Date(dueMs-config.days*86400000).toISOString().slice(0,10)===date)return false
  }
  return true
}
async function completeRoutineEarly(r:Row){
  if(!canCompleteRoutineEarly(r)||busy.value)return
  if(!confirm('确认今天已完成「'+r.title+'」？将记录实际完成日期并重新计算下次到期日。'))return
  await update(()=>api('/routines/'+r.id+'/mark','POST',{date:today(),status:'completed',early:true}), '已提前完成，下一次按今天重新计算')
  if(!error.value)emit('tasksChanged')
}
function routineLabel(r:Row){
  const config=(()=>{try{return typeof r.repeat_config==='string'?JSON.parse(r.repeat_config):r.repeat_config||{}}catch{return {}}})()
  if(r.repeat_type==='weekly'&&config.excludeJapaneseHolidays)return '工作日'
  return r.repeat_type==='once'?'一次性':r.repeat_type==='daily'?'每天':r.repeat_type==='weekly'?'每周':
    r.repeat_type==='monthly'?'每月':r.repeat_type==='interval'?'按间隔':
    r.repeat_type==='workday'?'工作日':'定期'
}
function profileName(id:string|null|undefined){
  return props.profiles.find(p=>p.id===id)?.displayName||''
}
const routineSubjectIsPet=computed(()=>props.profiles.some(p=>p.id===routineSubject.value&&p.type==='pet'))
watch(routineSubject,id=>{
  routineHealthType.value=props.profiles.some(p=>p.id===id&&p.type==='pet')?'other':''
})
const memoryTitle=ref(''),memoryStory=ref(''),memoryDate=ref(new Date().toISOString().slice(0,10))
const photoFiles=ref<File[]>([]),photos=ref<Record<string,string[]>>({}),localPhotoBlobs=ref<Record<string,Blob[]>>({})
const cloudEnabled=ref(false),cloudPhotos=ref<Record<string,Array<{id:string;uploadedBy:string}>>>({})
const paste=ref(''),importTargetId=ref(''),preview=ref<Row|null>(null),tripDetail=ref<Row|null>(null),tripProgress=ref<Row[]>([])
let photoUrls:string[]=[]
let lastTodayValue=''
function refreshOnResume(){
  if(document.visibilityState!=='visible')return
  const current=today()
  if(displayedDay.value!==current){
    displayedDay.value=current
    if(props.mode==='today'||props.mode==='family'||props.mode==='plans')void fetchMode()
  }
}
async function api(path:string,method='GET',body?:unknown):Promise<any>{
  const response=await fetch('/api'+path,{method,cache:'no-store',credentials:'same-origin',
    ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
  const data=await response.json()
  if(!response.ok)throw Error(String(data?.error||'server_error'))
  return data
}
async function fetchMode(){
  const requestId=++activeFetch
  const currentMode=props.mode
  error.value=''
  listLoading.value=true
  if(currentMode==='memories'){
    items.value=[]
    photos.value={};cloudPhotos.value={};localPhotoBlobs.value={}
    for(const url of photoUrls)URL.revokeObjectURL(url)
    photoUrls=[]
  }
  try{
    if(props.mode==='today'){
      lastTodayValue=today()
      const upcoming=await api('/anniversaries/upcoming')
      if(requestId!==activeFetch)return
      items.value=upcoming.items||[]
    }else if(props.mode==='family'){
      const past=anniversaryView.value==='past'
      const path=past?listPath('anniversaries'):'/anniversaries/upcoming'
      const data=await api(path)
      if(requestId!==activeFetch||props.mode!=='family'||past!==(anniversaryView.value==='past')||
        (past&&path!==listPath('anniversaries')))return
      items.value=data.items||[]
      listCursors.value.anniversaries=past?data.nextCursor||null:null
    }else if(props.mode==='plans'){
      const kinds=['wishes','goals','shopping','trips','routines','tasks']
      const paths=kinds.map(kind=>listPath(kind))
      const pages=await Promise.all(paths.map(path=>api(path)))
      if(requestId!==activeFetch||props.mode!=='plans'||paths.some((path,i)=>path!==listPath(kinds[i])))return
      kinds.forEach((kind,i)=>{
        assignRows(kind,pages[i].items||[])
        listCursors.value[kind]=pages[i].nextCursor||null
      })
    }else if(props.mode==='memories'){
      const path=listPath('memories')
      const data=await api(path)
      if(requestId!==activeFetch||props.mode!=='memories'||path!==listPath('memories'))return
      items.value=data.items||[]
      listCursors.value.memories=data.nextCursor||null
      await loadPhotos(requestId)
    }
  }catch(e){if(requestId===activeFetch)error.value=(e as Error).message}
  finally{if(requestId===activeFetch)listLoading.value=false}
}
async function update(action:()=>Promise<any>,successMessage='已保存'){
  error.value='';busy.value=true
  try{await action();await fetchMode();notify(successMessage)}
  catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
function today(){const d=new Date(Date.now()+9*3600000);return d.toISOString().slice(0,10)}
async function addAnniversary(){
  if(!eventTitle.value.trim()||!eventDate.value)return
  await update(()=>api('/anniversaries','POST',{title:eventTitle.value,eventDate:eventDate.value,repeatMode:eventRepeat.value,advanceDays:[30,7,1,0],visibility:'household'}))
  if(!error.value){eventTitle.value='';eventDate.value=''}
}
async function addRoutine(){
  if(!routineTitle.value.trim())return
  const repeatConfig=routineRepeat.value==='interval'?{days:intervalDays.value}:routineRepeat.value==='monthly'?{day:Number(today().slice(8))}:
    routineRepeat.value==='weekly'?{weekdays:[new Date().getDay()]}:{}
  await update(()=>api('/routines','POST',{title:routineTitle.value,repeatType:routineRepeat.value,
    repeatConfig:{...repeatConfig,...(routineRepeat.value==='interval'?{anchor:intervalAnchor.value}:{})},anchorDate:today(),
    subjectProfileId:routineSubject.value||null,healthRecordType:routineSubjectIsPet.value?routineHealthType.value||null:null,
    visibility:'household'}))
  if(!error.value)routineTitle.value=''
}
async function markRoutine(r:Row,done:boolean){
  await update(()=>api('/routines/'+r.id+'/mark','POST',{date:today(),status:done?'completed':'open'}),done?'已完成':'已撤销完成')
}
async function addWish(){
  await update(()=>api('/wishes','POST',{title:wishTitle.value,wishType:wishType.value,
    estimatedAmount:Number(wishBudget.value),currency:'JPY',visibility:wishVisibility.value}))
  if(!error.value)wishTitle.value=''
}
async function addGoal(){
  await update(()=>api('/goals','POST',{title:goalTitle.value,targetAmount:Number(goalAmount.value),
    reservedAmount:0,currency:'JPY',targetOn:goalTarget.value||null,visibility:'household'}))
  if(!error.value)goalTitle.value=''
}
async function reserve(g:Row){
  const value=prompt('为这个累计目标设置多少期初储值额？（不会产生家計簿交易）',String(g.reserved_amount||0))
  if(value===null)return
  const amount=Number(value)
  if(!Number.isSafeInteger(amount)||amount<0){error.value='请输入有效金额';return}
  await update(()=>api('/goals/'+g.id,'PATCH',{title:g.title,targetAmount:g.target_amount,
    reservedAmount:amount,currency:g.currency,targetOn:g.target_on,visibility:g.visibility,wishId:g.wish_id}))
}
async function addShopping(){
  await update(()=>api('/shopping','POST',{title:shoppingTitle.value,quantity:1,visibility:'household'}))
  if(!error.value)shoppingTitle.value=''
}
async function toggleShopping(x:Row){
  await update(()=>api('/shopping/'+x.id+'/toggle','POST',{completed:!x.completed_at}),x.completed_at?'已撤销完成':'已完成')
}
async function convertWish(w:Row){
  const destination=prompt('目的地（例如北海道）',w.title)
  if(!destination)return
  await update(()=>api('/wishes/'+w.id+'/start-trip','POST',{title:w.title,destination}))
}
async function selectTrip(id:string){
  try{const data=await api('/trips/'+id);tripDetail.value=data.trip;tripProgress.value=data.progress||[]}
  catch(e){error.value=(e as Error).message}
}
function itemDone(externalId:string){return !!tripProgress.value.find(p=>p.itemId===externalId&&p.completedAt)}
async function toggleTrip(id:string){
  if(!tripDetail.value)return
  try{
    await api('/trips/'+tripDetail.value.id+'/progress','POST',{itemId:id,completed:!itemDone(id)})
    await selectTrip(tripDetail.value.id)
    notify('旅行事项已更新')
  }catch(e){error.value=(e as Error).message}
}
async function editTripItem(item:Row){
  if(!tripDetail.value||tripDetail.value.createdBy!==props.userId)return
  const title=prompt('修改明细名称',item.label||item.title)
  if(title===null)return
  if(!title.trim()||title.length>150){error.value='名称须为 1～150 个字符';return}
  try{
    const payload={title:title.trim(),...(item.quantity?{quantity:item.quantity}:{})}
    await api('/trips/'+tripDetail.value.id+'/items/'+encodeURIComponent(item.externalId),'PATCH',payload)
    await selectTrip(tripDetail.value.id)
    notify('修改已保存')
  }catch(e){error.value=(e as Error).message}
}
async function removeTripItem(item:Row){
  if(!tripDetail.value||tripDetail.value.createdBy!==props.userId||
    !confirm('删除这条旅行明细吗？关联的打勾记录也将清除。'))return
  try{
    await api('/trips/'+tripDetail.value.id+'/items/'+encodeURIComponent(item.externalId),'DELETE')
    await selectTrip(tripDetail.value.id)
    notify('旅行明细已删除')
  }catch(e){error.value=(e as Error).message}
}
async function previewTrip(){
  try{const data=JSON.parse(paste.value);const result=await api('/trips/import','POST',{preview:true,payload:data,targetTripId:importTargetId.value||null})
    preview.value={...result,payload:data};error.value=''}
  catch(e){preview.value=null;error.value=(e as Error).message}
}
async function importTrip(){
  if(!preview.value)return
  const change=preview.value.changes
  if(change==='update'&&!confirm('会更新原旅行内容，但不会删除已完成事项。确定更新吗？'))return
  await update(()=>api('/trips/import','POST',{payload:preview.value?.payload,
    visibility:'household',targetTripId:importTargetId.value||null,confirmReplace:change==='update'}))
  if(!error.value){paste.value='';preview.value=null}
}
async function removeCloudPhoto(id:string){
  if(!confirm('删除这张云端照片吗？本机原图不会删除。'))return
  try{
    await api('/media/'+id,'DELETE')
    await loadPhotos()
    notify('云端照片已删除')
  }catch(e){error.value=(e as Error).message}
}
async function addMemory(){
  if(!memoryTitle.value.trim()||!memoryDate.value)return
  error.value='';busy.value=true
  try{
    const result=await api('/memories','POST',{title:memoryTitle.value,story:memoryStory.value,
      happenedOn:memoryDate.value,visibility:'private'})
    if(result.id)for(const f of photoFiles.value.slice(0,10)){
      await saveLocalPhoto(props.userId,result.id,f)
      if(cloudEnabled.value){
        try{
          const compressed=await compressPhoto(f)
          const sent=await fetch('/api/media/upload?memoryId='+encodeURIComponent(result.id),{
            method:'POST',credentials:'same-origin',
            headers:{'content-type':'image/jpeg'},body:compressed})
          if(!sent.ok)notify('本机照片已保存，但云端备份部分失败','warning')
        }catch{notify('本机照片已保存，但云端暂不可用','warning')}
      }
    }
    memoryTitle.value='';memoryStory.value='';photoFiles.value=[]
    await fetchMode()
    if(!toast.value)notify('回忆已保存')
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function loadPhotos(requestId=activeFetch){
  for(const x of photoUrls)URL.revokeObjectURL(x)
  photoUrls=[];photos.value={};localPhotoBlobs.value={};cloudPhotos.value={}
  try{
    const media=await api('/media')
    if(requestId!==activeFetch)return
    cloudEnabled.value=!!media.cloudAvailable
    for(const item of media.items||[]){
      if(!item.memoryId)continue
      if(!cloudPhotos.value[item.memoryId])cloudPhotos.value[item.memoryId]=[]
      cloudPhotos.value[item.memoryId].push({id:item.id,uploadedBy:item.uploadedBy})
    }
  }catch{cloudEnabled.value=false}
  for(const m of items.value){
    if(requestId!==activeFetch)return
    try{
      if(m.created_by!==props.userId)continue
      const list=await listLocalPhotos(props.userId,m.id)
      if(requestId!==activeFetch)return
      if(!list.length)continue
      localPhotoBlobs.value[m.id]=list
      photos.value[m.id]=list.map(b=>{const url=URL.createObjectURL(b);photoUrls.push(url);return url})
    }catch{ /* private local storage may be unavailable in some Safari modes */ }
  }
}
onMounted(()=>document.addEventListener('visibilitychange',refreshOnResume))
onBeforeUnmount(()=>{
  activeFetch++
  for(const x of photoUrls)URL.revokeObjectURL(x)
  document.removeEventListener('visibilitychange',refreshOnResume)
})
watch(()=>[props.mode,props.profileRevision],fetchMode,{immediate:true})
watch([planScope,planYear,planMonth],()=>{if(props.mode==='plans')void fetchMode()})
watch([memoryYear,memoryMonth],()=>{if(props.mode==='memories')void fetchMode()})
watch([anniversaryView,anniversaryYear,anniversaryMonth],()=>{
  anniversaryExpanded.value=false
  if(props.mode==='family')void fetchMode()
})
watch(anniversaryYear,value=>{if(!value)anniversaryMonth.value=''})
watch(planYear,value=>{if(!value)planMonth.value=''})
watch(memoryYear,value=>{if(!value)memoryMonth.value=''})
</script>

<template>
  <section class="life-area">
    <p v-if="error" role="alert" class="life-error">{{ error }}</p>
    <PageToast :toast="toast" />

    <template v-if="mode==='today'">
      <!-- Extra reminders are pinned above today's checklist in App.vue; here only anniversaries remain. -->
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="calendar-heart" :size="21" /> 未来 30 天的纪念日</h2>
          <p v-if="listLoading" class="life-empty" role="status">正在读取纪念日…</p>
          <p v-else-if="!todayAnniversaries.length" class="life-empty">未来 30 天没有纪念日，可以在「家庭」查看全部重要日子。</p>
          <div v-for="e in (listLoading?[]:todayAnniversaries.slice(0,8))" :key="e.id" class="life-row upcoming-anniversary">
            <div class="anniversary-subject"><b>{{ e.title }}</b>
              <small v-if="milestone(e)" class="anniversary-milestone">{{ milestone(e) }}</small>
            </div>
            <div class="anniversary-countdown">
              <strong>{{ countdown(e.nextOn) }}</strong>
              <time :datetime="e.nextOn">{{ e.nextOn }}</time>
            </div>
          </div>
        </section>
    </template>

    <template v-else-if="mode==='family'">
      <section class="life-card">
        <h2 class="life-heading"><AppIcon name="calendar-heart" :size="21" /> 家人的重要日子</h2>
        <p class="life-caption">档案生日会自动每年提醒。过去的一次性纪念日保存在历史中，可以按年月查询。</p>
        <div class="archive-tabs" role="group" aria-label="重要日子筛选">
          <button type="button" :class="{selected:anniversaryView==='upcoming'}"
            :aria-pressed="anniversaryView==='upcoming'" @click="anniversaryView='upcoming'">即将到来</button>
          <button type="button" :class="{selected:anniversaryView==='past'}"
            :aria-pressed="anniversaryView==='past'" @click="anniversaryView='past'">过去的日子</button>
        </div>
        <div v-if="anniversaryView==='past'" class="archive-date-filters">
          <label>年份<select v-model="anniversaryYear" aria-label="纪念日历史年份">
            <option value="">全部年份</option>
            <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 年</option>
          </select></label>
          <label>月份<select v-model="anniversaryMonth" :disabled="!anniversaryYear" aria-label="纪念日历史月份">
            <option value="">全年</option>
            <option v-for="month in monthOptions" :key="month" :value="month">{{ Number(month) }} 月</option>
          </select></label>
        </div>
        <p v-if="anniversaryView==='past'&&!items.length" class="life-empty">该时间范围没有过去的一次性重要日子。</p>
        <template v-for="e in upcomingAnniversaries" :key="e.id">
          <SwipeActions :id="e.id" scope="anniversaries"
            :allow-edit="canEdit(e)||canEditBirthday(e)" :allow-delete="canEdit(e)"
            @edit="editAnniversary(e)" @delete="removeItem('anniversaries',e)">
            <div class="life-row"><div class="life-details"><b>{{ e.title }}</b>
              <small>{{ e.nextOn||e.event_date }}</small></div></div>
          </SwipeActions>
          <LifeItemEditor v-if="editing?.kind==='anniversaries'&&editing.item.id===e.id"
            kind="anniversaries" :item="e" @saved="changed" @cancel="editing=null"/>
        </template>
        <button v-if="anniversaryView==='upcoming'&&items.length>5" type="button" class="life-more" @click="anniversaryExpanded=!anniversaryExpanded">
          {{ anniversaryExpanded?'收起重要日子':'查看全部重要日子（'+items.length+'）' }}
        </button>
        <button v-if="anniversaryView==='past'&&listCursors.anniversaries" type="button" class="life-more"
          :disabled="pageBusy.anniversaries" @click="loadMore('anniversaries')">加载更多历史纪念日</button>
        <form class="life-form" @submit.prevent="addAnniversary">
          <input v-model.trim="eventTitle" required placeholder="纪念日名称"/><DateField v-model="eventDate" required />
          <select v-model="eventRepeat"><option value="yearly">每年</option><option value="once">一次性</option><option value="monthly">每月</option></select>
          <button :disabled="busy">添加纪念日</button>
        </form>
      </section>
    </template>

    <template v-else-if="mode==='plans'">
      <PlanCreator v-if="planScope==='active'" :profiles="props.profiles"
        @created="planCreated" @task-created="emit('tasksChanged')"/>
      <div class="plan-filter-tabs" role="group" aria-label="按计划类型筛选">
        <button v-for="tab in [
          {id:'all',label:'全部'},{id:'routine',label:'任务'},{id:'shopping',label:'购物'},
          {id:'wish',label:'心愿'},{id:'goal',label:'储值'},{id:'trip',label:'旅行'}]"
          :key="tab.id" type="button" :class="{selected:planType===tab.id}"
          :aria-pressed="planType===tab.id" @click="planType=tab.id as PlanType">
          {{ tab.label }}</button>
      </div>
      <div class="archive-toolbar">
        <div class="archive-tabs" role="group" aria-label="计划记录筛选">
          <button type="button" :class="{selected:planScope==='active'}" :aria-pressed="planScope==='active'"
            @click="planScope='active'">进行中</button>
          <button type="button" :class="{selected:planScope==='history'}" :aria-pressed="planScope==='history'"
            @click="planScope='history'">已完成／历史</button>
        </div>
        <div v-if="planScope==='history'" class="archive-date-filters">
          <label>年份
            <select v-model="planYear" aria-label="历史记录年份"><option value="">全部年份</option>
              <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 年</option>
            </select>
          </label>
          <label>月份
            <select v-model="planMonth" :disabled="!planYear" aria-label="历史记录月份"><option value="">全年</option>
              <option v-for="month in monthOptions" :key="month" :value="month">{{ Number(month) }} 月</option>
            </select>
          </label>
        </div>
        <p v-if="planScope==='history'" class="life-caption">历史不会自动删除，可按年月查找。切回「进行中」就能继续管理未完成项目。</p>
      </div>
      <div class="life-grid">
        <section v-if="planType==='all'||planType==='routine'" class="life-card">
          <h2 class="life-heading"><AppIcon name="repeat" :size="21" /> 任务／定期计划</h2>
          <p class="life-caption">一次性任务和重复任务都由上方「新增计划」创建。到期当天自动显示在「今天」。</p>
          <template v-for="r in routines" :key="r.id">
            <SwipeActions :id="r.id" scope="routines" :allow-edit="canEdit(r)" :allow-delete="canEdit(r)"
              @edit="edit('routines',r)" @delete="removeItem('routines',r)">
              <div class="life-row" :class="{'detail-completed':r.enabled===0,'routine-has-early-complete':planScope==='active'&&canCompleteRoutineEarly(r)}">
                <div class="life-details"><b class="detail-name">{{ r.title }}</b>
                  <small>{{ r.enabled===0?'已停用':routineLabel(r) }}<template v-if="profileName(r.subject_profile_id)"> · {{ profileName(r.subject_profile_id) }}</template><template v-if="r.health_record_type"> · 完成后记入护理</template></small></div>
              </div>
            </SwipeActions>
            <div v-if="planScope==='active'&&canCompleteRoutineEarly(r)" class="routine-early-complete">
              <small>下次预计：{{ routineNextDue(r) }}</small>
              <button type="button" class="life-link" :disabled="busy" @click="completeRoutineEarly(r)">今天提前完成</button>
            </div>
            <LifeItemEditor v-if="editing?.kind==='routines'&&editing.item.id===r.id"
              kind="routines" :item="r" :profiles="props.profiles" @saved="changed" @cancel="editing=null"/>
          </template>
          <template v-for="t in oneTimePlans" :key="t.id">
            <SwipeActions :id="t.id" scope="one-time-plans" :allow-edit="canEdit(t)" :allow-delete="canEdit(t)"
              @edit="editOnce(t)" @delete="deleteOnce(t)">
              <div class="life-row" :class="{'detail-completed':!!t.completedAt}">
                <div class="life-details">
                  <b class="detail-name">{{ t.title }}</b>
                  <small>一次性任务 · {{ t.dueOn||'无截止日期' }}
                    <template v-if="profileName(t.subjectProfileId)"> · {{ profileName(t.subjectProfileId) }}</template>
                    <template v-if="t.completedAt"> · 已完成</template>
                  </small>
                </div>
              </div>
            </SwipeActions>
            <form v-if="onceEditing?.id===t.id" class="detail-editor" @submit.prevent="saveOnce">
              <b>编辑一次性任务</b>
              <label>名称<input v-model="onceTitle" maxlength="150" required /></label>
              <label>截止日期<DateField v-model="onceDate" /></label>
              <label><input v-model="onceRemind" type="checkbox" /> 开启提醒</label>
              <div class="detail-actions">
                <button type="button" @click="onceEditing=null">取消</button>
                <button type="submit">保存修改</button>
              </div>
            </form>
          </template>
          <p v-if="!routines.length&&!oneTimePlans.length" class="life-empty">{{ planScope==='active'?'还没有任务计划':'暂无历史任务计划' }}</p>
          <button v-if="listCursors.routines" class="life-more" type="button" :disabled="pageBusy.routines"
            @click="loadMore('routines')">加载更多定期任务</button>
          <button v-if="listCursors.tasks" class="life-more" type="button" :disabled="pageBusy.tasks"
            @click="loadMore('tasks')">加载更多一次性任务</button>

        </section>
        <section v-if="planType==='all'||planType==='wish'" class="life-card">
          <h2 class="life-heading"><AppIcon name="heart" :size="21" /> 心愿计划</h2>
          <template v-for="w in items" :key="w.id">
            <SwipeActions :id="w.id" scope="wishes" :allow-edit="canEdit(w)" :allow-delete="canEdit(w)"
              @edit="edit('wishes',w)" @delete="removeItem('wishes',w)">
              <div class="life-row" :class="{'detail-completed':w.status==='completed'||w.status==='cancelled'}">
                <div class="life-details"><b class="detail-name">{{ w.title }}</b><small>{{ w.wish_type }} · {{ w.status }}<template v-if="w.target_on"> · {{ w.target_on }}</template></small>
                  <small v-if="linkedGoal(w)">已关联储值计划：{{ linkedGoal(w)?.title }}</small></div>
                <button v-if="w.wish_type==='trip'&&w.status!=='completed'"
                  type="button" class="life-link" @click="convertWish(w)">计划</button>
              </div>
            </SwipeActions>
            <LifeItemEditor v-if="editing?.kind==='wishes'&&editing.item.id===w.id"
              kind="wishes" :item="w" @saved="changed" @cancel="editing=null"/>
          </template>
          <p v-if="!items.length" class="life-empty">{{ planScope==='active'?'暂无进行中的心愿':'暂无已完成的心愿' }}</p>
          <button v-if="listCursors.wishes" class="life-more" type="button" :disabled="pageBusy.wishes"
            @click="loadMore('wishes')">加载更多心愿</button>

        </section>
        <section v-if="planType==='all'||planType==='goal'" class="life-card">
          <h2 class="life-heading"><AppIcon name="wallet" :size="21" /> 储值计划</h2>
          <p class="life-caption">储值方式支持累计目标、每月目标和每年目标。选定期间只读汇总家計簿收支，并可单独调整金额。</p>
          <template v-for="g in goals" :key="g.id">
            <SwipeActions :id="g.id" scope="goals" :allow-edit="canEdit(g)" :allow-delete="canEdit(g)"
              @edit="edit('goals',g)" @delete="removeItem('goals',g)">
              <div class="life-row">
                <div class="life-details"><b class="detail-name">{{ g.title }}</b>
                  <small v-if="(g.goal_mode||'once')==='once'">累计目标 ¥{{ Number(g.target_amount).toLocaleString() }} · 期初 ¥{{ Number(g.reserved_amount).toLocaleString() }}</small>
                  <small v-else>{{ g.goal_mode==='monthly'?'每月':'每年' }}目标 ¥{{ Number(g.target_amount).toLocaleString() }}</small>
                  <small v-if="g.start_on">开始：{{ g.start_on }}<template v-if="g.target_on"> · 结束：{{ g.target_on }}</template></small>
                  <small v-if="g.wish_id">已关联心愿计划</small></div>
                <button v-if="isOwner" type="button" class="life-link" @click="toggleFinance('goal',g.id)">账目与调整额</button>
              </div>
            </SwipeActions>
            <LifeItemEditor v-if="editing?.kind==='goals'&&editing.item.id===g.id"
              kind="goals" :item="g" @saved="changed" @cancel="editing=null"/>
            <FinancePanel v-if="isOwner&&financeDetail?.kind==='goal'&&financeDetail.id===g.id"
              :key="'goal-finance-'+g.id" :trips="trips" :goals="goals" :owner="isOwner"
              embedded-kind="goal" :embedded-id="g.id"/>
          </template>
          <p v-if="!goals.length" class="life-empty">{{ planScope==='active'?'暂无进行中的储值计划':'暂无已完成的目标' }}</p>
          <button v-if="listCursors.goals" class="life-more" type="button" :disabled="pageBusy.goals"
            @click="loadMore('goals')">加载更多目标</button>

        </section>
        <section v-if="planType==='all'||planType==='shopping'" class="life-card">
          <h2 class="life-heading"><AppIcon name="shopping" :size="21" /> 购物计划</h2>
          <p class="life-caption">关联家計簿真实支出后自动完成；当天变灰并划线，次日移入历史。</p>
          <template v-for="s in visibleShopping" :key="s.id">
            <SwipeActions :id="s.id" scope="shopping" :allow-edit="canEdit(s)" :allow-delete="canEdit(s)"
              @edit="edit('shopping',s)" @delete="removeItem('shopping',s)">
              <div class="life-row shopping-line" :class="{'detail-completed':!!s.completed_at}">
                <label class="shopping-check"><input type="checkbox" :checked="!!s.completed_at" :disabled="busy" @change="toggleShopping(s)"/>
                  <span class="detail-name">{{ s.title }} <small v-if="s.quantity>1">× {{ s.quantity }}</small>
                    <small v-if="s.ledger_entry_id">已关联家計簿明细 #{{ s.ledger_entry_id }}</small></span></label>
                <button v-if="isOwner&&(canEdit(s)||s.visibility==='household')" type="button"
                  class="life-link" @click="toggleLedger(s.id)">账目与调整额</button>
              </div>
            </SwipeActions>
            <LifeItemEditor v-if="editing?.kind==='shopping'&&editing.item.id===s.id"
              kind="shopping" :item="s" @saved="changed" @cancel="editing=null"/>
            <ShoppingLedgerPicker v-if="ledgerPickerId===s.id" :shopping-id="s.id" :linked-id="s.ledger_entry_id"
              @saved="changed" @close="ledgerPickerId=null"/>
          </template>
          <p v-if="!visibleShopping.length" class="life-empty">{{ planScope==='active'?'没有待购买的东西':'没有已完成的购物记录' }}</p>
          <button v-if="listCursors.shopping" class="life-more" type="button" :disabled="pageBusy.shopping"
            @click="loadMore('shopping')">加载更多购物记录</button>


        </section>
        <section v-if="planType==='all'||planType==='trip'" class="life-card">
          <h2 class="life-heading"><AppIcon name="plane" :size="21" /> 旅行计划</h2>
          <template v-for="t in trips" :key="t.id">
            <SwipeActions :id="t.id" scope="trips" :allow-edit="canEdit(t)" :allow-delete="canEdit(t)"
              @edit="edit('trips',t)" @delete="removeItem('trips',t)">
              <div class="life-row" :class="{'detail-completed':t.status==='completed'||t.status==='cancelled'||(t.endOn&&t.endOn<today())}">
                <div class="life-details"><b class="detail-name">{{ t.title }}</b>
                  <small>{{ t.destination }} · {{ t.startOn||'日期待确定' }}</small></div>
                <div class="trip-card-actions">
                  <button type="button" class="life-link" @click="selectTrip(t.id)">行程</button>
                  <button v-if="isOwner" type="button" class="life-link" @click="toggleFinance('trip',t.id)">费用</button>
                </div>
              </div>
            </SwipeActions>
            <LifeItemEditor v-if="editing?.kind==='trips'&&editing.item.id===t.id"
              kind="trips" :item="t" @saved="changed" @cancel="editing=null"/>
            <FinancePanel v-if="isOwner&&financeDetail?.kind==='trip'&&financeDetail.id===t.id"
              :key="'trip-finance-'+t.id" :trips="trips" :goals="goals" :owner="isOwner"
              embedded-kind="trip" :embedded-id="t.id"/>
          </template>
          <p v-if="!trips.length" class="life-empty">{{ planScope==='active'?'暂无进行中的旅行':'暂无已结束的旅行' }}</p>
          <button v-if="listCursors.trips" class="life-more" type="button" :disabled="pageBusy.trips"
            @click="loadMore('trips')">加载更多旅行</button>
          <div v-if="tripDetail" class="trip-detail">
            <h3>{{ tripDetail.title }}</h3>
            <template v-if="tripDetail.plan">
              <div v-for="d in tripDetail.plan.trip.days" :key="d.date" class="trip-day"><b>{{ d.date }}</b>
                <SwipeActions v-for="it in d.items" :key="it.externalId" :id="it.externalId" :scope="'trip-'+tripDetail.id"
                    :allow-edit="tripDetail.createdBy===props.userId"
                    :allow-delete="tripDetail.createdBy===props.userId"
                    @edit="editTripItem(it)" @delete="removeTripItem(it)">
                  <div class="trip-detail-row">
                  <label class="trip-item" :class="{done:itemDone(it.externalId)}">
                    <input type="checkbox" :checked="itemDone(it.externalId)" @change="toggleTrip(it.externalId)"/>
                    <span>{{ it.startTime||'待定' }} · {{ it.title }}</span>
                  </label>
                </div>
                </SwipeActions></div>
              <div v-if="tripDetail.plan.trip.tasks?.length" class="trip-day">
                <b class="life-heading"><AppIcon name="clipboard-check" :size="18" /> 出发前待办</b>
                <SwipeActions v-for="task in tripDetail.plan.trip.tasks" :key="task.externalId" :id="task.externalId" :scope="'trip-'+tripDetail.id"
                    :allow-edit="tripDetail.createdBy===props.userId"
                    :allow-delete="tripDetail.createdBy===props.userId"
                    @edit="editTripItem(task)" @delete="removeTripItem(task)">
                  <div class="trip-detail-row">
                  <label class="trip-item" :class="{done:itemDone(task.externalId)}">
                    <input type="checkbox" :checked="itemDone(task.externalId)" @change="toggleTrip(task.externalId)"/>
                    <span>{{ task.title }} · {{ task.dueDate||'未设置日期' }}</span>
                  </label>
                </div>
                </SwipeActions>
              </div>
              <div v-for="list in tripDetail.plan.trip.packingLists||[]" :key="list.externalId" class="trip-day">
                <b class="life-heading"><AppIcon name="shopping" :size="18" /> 行李清单 · {{ list.owner }}</b>
                <SwipeActions v-for="piece in list.items" :key="piece.externalId" :id="piece.externalId" :scope="'trip-'+tripDetail.id"
                    :allow-edit="tripDetail.createdBy===props.userId"
                    :allow-delete="tripDetail.createdBy===props.userId"
                    @edit="editTripItem(piece)" @delete="removeTripItem(piece)">
                  <div class="trip-detail-row">
                  <label class="trip-item" :class="{done:itemDone(piece.externalId)}">
                    <input type="checkbox" :checked="itemDone(piece.externalId)" @change="toggleTrip(piece.externalId)"/>
                    <span>{{ piece.label }} × {{ piece.quantity }}</span>
                  </label>
                </div>
                </SwipeActions>
              </div>
              <div v-if="tripDetail.plan.trip.bookings?.length" class="trip-day">
                <b class="life-heading"><AppIcon name="plane" :size="18" /> 交通和预订</b>
                <SwipeActions v-for="booking in tripDetail.plan.trip.bookings" :key="booking.externalId" :id="booking.externalId" :scope="'trip-'+tripDetail.id"
                    :allow-edit="tripDetail.createdBy===props.userId"
                    :allow-delete="tripDetail.createdBy===props.userId"
                    @edit="editTripItem(booking)" @delete="removeTripItem(booking)">
                  <div class="trip-detail-row">
                  <span>{{ booking.title }} · {{ booking.status }}</span>
                </div>
                </SwipeActions>
              </div>
            </template>
            <p v-else class="life-caption">尚未导入行程，可以在下方导入 ChatGPT 制定的 JSON。</p>
          </div>
          <details class="trip-import"><summary>从 ChatGPT 导入旅行计划 JSON</summary>
            <p class="life-caption">粘贴 HomeFlow Trip v1 格式。先验证预览，再保存；更新旧计划会保留完成记录。</p>
            <label>导入到哪个旅行项目？
              <select v-model="importTargetId"><option value="">新建旅行项目</option><option v-for="t in trips" :key="t.id" :value="t.id">{{ t.title }}</option></select>
            </label>
            <textarea v-model="paste" rows="6" placeholder="粘贴完整的 JSON 内容"></textarea>
            <button class="life-light" @click="previewTrip">验证与预览</button>
            <div v-if="preview" class="trip-preview">
              <b>{{ preview.changes==='new'?'新旅行':preview.changes==='unchanged'?'未发生变化':'更新已有旅行' }}</b>
              <p>{{ preview.summary.days }} 天 / {{ preview.summary.itineraryItems }} 项行程 / {{ preview.summary.tasks }} 项准备任务</p>
              <button :disabled="busy" @click="importTrip">确认导入</button>
            </div>
          </details>
        </section>
      </div>
     </template>

    <template v-else-if="mode==='memories'">
      <section class="life-card">
        <h2 class="life-heading"><AppIcon name="book-heart" :size="21" /> 留下一段美好的回忆</h2>
        <form class="life-form" @submit.prevent="addMemory">
          <input v-model.trim="memoryTitle" required maxlength="150" placeholder="今天有什么值得记住？"/>
          <label>发生日期<DateField v-model="memoryDate" required /></label>
          <textarea v-model="memoryStory" maxlength="8000" rows="3" placeholder="写下一段日记……"></textarea>
          <label>可选照片（仅存本机）
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" @change="photoFiles=Array.from(($event.target as HTMLInputElement).files||[]).slice(0,10)"/></label>
          <p class="life-caption">{{ cloudEnabled?'照片会同时保存到本机和私有云端，家庭共享范围以这条回忆为准。':'当前只在本机保存照片，不会自动跨设备同步；请定期导出 ZIP 备份。' }}</p>
          <button :disabled="busy">保存到时光轴</button>
        </form>
      </section>
      <section class="life-card"><h2 class="life-heading"><AppIcon name="images" :size="21" /> 我们的时光轴</h2>
        <div class="archive-date-filters">
          <label>年份
            <select v-model="memoryYear" aria-label="回忆年份"><option value="">全部年份</option>
              <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 年</option>
            </select>
          </label>
          <label>月份
            <select v-model="memoryMonth" :disabled="!memoryYear" aria-label="回忆月份"><option value="">全年</option>
              <option v-for="month in monthOptions" :key="month" :value="month">{{ Number(month) }} 月</option>
            </select>
          </label>
        </div>
        <p class="life-caption">默认只显示最近 6 条，切换年月可查询旧回忆，照片按当前显示的记录加载。</p>
        <p v-if="listLoading" class="life-caption" role="status">正在读取时光轴…</p>
        <p v-else-if="!items.length" class="life-empty">这个时间范围没有回忆，可以选择其他年月。</p>
        <article v-for="m in listLoading?[]:items" :key="m.id" class="memory">
          <SwipeActions :id="m.id" scope="memories" :allow-edit="canEdit(m)" :allow-delete="canEdit(m)"
            @edit="edit('memories',m)" @delete="removeItem('memories',m)">
            <div class="memory-swipe-heading"><time>{{ m.happened_on }}</time><h3>{{ m.title }}</h3></div>
          </SwipeActions>
          <LifeItemEditor v-if="editing?.kind==='memories'&&editing.item.id===m.id"
            kind="memories" :item="m" @saved="changed" @cancel="editing=null"/>
          <div v-if="cloudPhotos[m.id]?.length" class="memory-photos cloud">
            <div v-for="remote in cloudPhotos[m.id]" :key="remote.id">
              <img :src="'/api/media/'+remote.id" :alt="m.title+' 云端照片'" loading="lazy"/>
              <button v-if="remote.uploadedBy===props.userId" type="button" class="life-link"
                @click="removeCloudPhoto(remote.id)">删除云端照片</button>
            </div>
          </div>
          <div v-if="photos[m.id]?.length" class="memory-photos">
            <div v-for="(image,i) in photos[m.id]" :key="image">
              <img :src="image" :alt="m.title+' 照片 '+(i+1)" loading="lazy"/>
              <button type="button" class="life-link" @click="downloadLocalPhoto(localPhotoBlobs[m.id][i],m.id+'-'+(i+1)+'.jpg')">保存照片</button>
            </div>
          </div>
          <p>{{ m.story }}</p><small class="memory-visibility"><AppIcon :name="m.visibility==='private'?'shield':'house'" :size="14" /> {{ m.visibility==='private'?'私人回忆':'家庭共享' }}</small>
        </article>
        <button v-if="!listLoading&&listCursors.memories" type="button" class="life-more" :disabled="pageBusy.memories"
          @click="loadMore('memories')">加载更多回忆</button>
      </section>
    </template>
  </section>
</template>

<style scoped>
.plan-filter-tabs{display:flex;gap:6px;overflow-x:auto;padding:0 0 11px;scrollbar-width:none}
.plan-filter-tabs button{border:1px solid #d8e6dc;background:#fff;color:#648171;border-radius:999px;
 padding:8px 12px;min-height:36px;flex:none;font-size:12px}
.plan-filter-tabs button.selected{background:#43866a;color:#fff;border-color:#43866a}
.trip-card-actions{display:flex;gap:5px;flex:none;flex-wrap:wrap}
.once-edit{background:#f6faf6;border-radius:12px;padding:12px}
.once-remind{display:flex!important;align-items:center;gap:9px}
.once-remind input{width:18px!important;min-height:18px!important}
.once-actions{display:flex;gap:8px}.once-actions button{flex:1}
@media(max-width:480px){.trip-card-actions{max-width:42%;justify-content:flex-end}
 .plan-filter-tabs button{padding:7px 10px}}

.life-row.routine-has-early-complete{border-bottom:0;padding-bottom:5px}
.routine-early-complete{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;margin:8px 0 12px;padding:7px 9px;border:1px solid #e1eae3;border-radius:12px;background:#f5f8f5;box-sizing:border-box}
.routine-early-complete small{flex:1;min-width:0;color:#82948b;font-size:11px;line-height:1.5;overflow-wrap:anywhere}
.routine-early-complete button{flex:none;font-size:12px;padding:8px 10px}
.life-area{margin:23px 0 5px}.life-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start}.life-card{background:#fff;border:1px solid #eeebe5;border-radius:18px;padding:20px;margin:0 0 16px;box-shadow:0 4px 16px #28332807}.life-card h2{font-size:17px;margin:0 0 11px}.life-card h3{font-size:15px}.life-caption{font-size:11px;line-height:1.7;color:#82948b}.life-empty{font-size:12px;color:#9ba69d;text-align:center;padding:14px 0}.life-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 0;border-bottom:1px solid #f0eee9;font-size:13px}.life-row label{display:flex;align-items:center;gap:8px}.life-row small{display:block;color:#87968b;margin-top:4px}.life-form{display:grid;gap:9px;margin-top:14px}.life-form input,.life-form select,.life-form textarea,.trip-import textarea{width:100%;padding:9px 11px;min-height:40px;border-radius:10px;border:1px solid #e0e7df;background:#fff;color:#283b30;font-size:13px}.life-form label{font-size:12px;color:#738477;display:grid;gap:5px}.life-form button,.trip-preview button{background:#478969;border:none;border-radius:10px;color:white;padding:10px 12px;font-weight:700}.life-link{color:#4a896b;background:#edf5ed;border:0;border-radius:9px;padding:8px;white-space:nowrap;font-size:12px}.life-error{background:#fff0eb;color:#a14d36;padding:12px;border-radius:10px;font-size:12px}.life-notice{background:#e5f2e8;color:#317355;padding:10px;border-radius:10px;font-size:12px}.trip-detail,.trip-import{padding:14px;background:#f6f8f2;border-radius:12px;margin-top:12px}.trip-import summary{cursor:pointer;font-size:13px;font-weight:700}.trip-import textarea{margin:10px 0}.trip-item{display:flex;align-items:center;gap:8px;font-size:12px;margin:9px 0}.trip-day{border-top:1px solid #e8ece6;padding:12px 0}
.trip-detail-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;flex-wrap:wrap}
.trip-detail-row .trip-item{min-width:0;flex:1;overflow-wrap:anywhere}
.trip-item.done span{color:#9aa99d;text-decoration:line-through}
.trip-item-actions{display:flex;gap:5px;flex:none}
.trip-item-actions button{border:0;border-radius:7px;background:#edf5ed;color:#43866a;padding:6px 8px;font-size:11px}
.trip-item-actions .remove{background:#faefeb;color:#ab5d4a}.life-light{padding:10px;border-radius:9px;background:white;color:#478969;border:1px solid #a2c5ad}.trip-preview{padding:12px 0;font-size:12px}.memory{border-left:2px solid #c1d8c7;margin:15px 0;padding:1px 14px}.memory time,.memory small{font-size:11px;color:#8a9d90}.memory h3{margin:8px 0}.memory p{font-size:13px;white-space:pre-wrap;line-height:1.7}.memory-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.memory-photos img{width:100%;height:165px;object-fit:cover;border-radius:12px}
.memory-photos button{margin-top:3px}
@media(max-width:720px){.life-grid{grid-template-columns:1fr}.life-card{padding:17px}}

/* Shared icon language and responsive form guards */
.life-heading{display:flex;align-items:center;gap:9px;color:#293f34;min-width:0}
.life-heading :deep(.app-icon){color:#43866a}
.memory-visibility{display:inline-flex;align-items:center;gap:5px}
.life-form,.life-card,.life-row,.trip-import,.trip-detail{min-width:0;max-width:100%}
.life-row>*{min-width:0;overflow-wrap:anywhere}
.life-row>button{flex:none}
.life-form input:not([type="checkbox"]),.life-form select,.life-form textarea,
.trip-import select,.trip-import textarea{width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.life-form input[type="date"]{min-inline-size:0}
.life-form label,.trip-import label{min-width:0;max-width:100%}
.life-form button{width:100%}
.life-details{min-width:0;flex:1}
.detail-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:5px;flex:none}
.life-row .detail-actions .life-link{font-size:11px;padding:6px 8px;min-width:0}
.life-danger{color:#a45b4c!important;background:#faefeb!important}
.detail-completed .detail-name{text-decoration:line-through;color:#9ba99f}
.detail-completed small{color:#a1aea5}
.shopping-check{display:flex;align-items:center;gap:9px;flex:1;min-width:0}
.shopping-check input{width:18px;height:18px;flex:none;accent-color:#43866a}
.shopping-check span{overflow-wrap:anywhere;min-width:0}
.shopping-history{border-top:1px solid #e5ece5;margin-top:13px}
.shopping-history summary{font-size:12px;color:#607b6a;cursor:pointer;padding:10px}
@media(max-width:520px){.shopping-line{align-items:flex-start;flex-wrap:wrap}.shopping-line .detail-actions{margin-left:25px;justify-content:flex-start}}
.today-routine-label{display:flex!important;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer}
.today-routine-label input[type="checkbox"]{width:20px;height:20px;flex:none;accent-color:#43866a}
.today-routine-row .routine-name{overflow-wrap:anywhere}
.today-routine-row.routine-completed .routine-name{text-decoration:line-through;color:#9daaa1}
.today-routine-row.routine-completed small{color:#7b9d86}
.upcoming-anniversary{align-items:center}
.anniversary-subject{min-width:0;display:grid;gap:3px;align-content:center}
.anniversary-subject b{overflow-wrap:anywhere}
.life-row .anniversary-milestone{display:block;color:#43866a;font-size:11px;font-weight:650;line-height:1.4;margin-top:3px}
.anniversary-countdown{display:grid;justify-items:end;gap:4px;text-align:right;flex:none}
.anniversary-countdown strong{font-size:13px;color:#43866a}
.anniversary-countdown time{font-size:12px;color:#85958b}
@media(max-width:420px){.anniversary-countdown{max-width:45%}.upcoming-anniversary>b{max-width:55%;overflow-wrap:anywhere}}
@media(max-width:720px){.life-grid{grid-template-columns:minmax(0,1fr)}}

.archive-toolbar{background:#fff;border:1px solid #eeebe5;border-radius:16px;padding:13px;margin-bottom:16px}
.archive-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));background:#f0f5ef;padding:4px;border-radius:12px;gap:4px}
.archive-tabs button{min-height:39px;border:0;background:transparent;color:#748b7d;border-radius:9px;font-size:13px;font-weight:650}
.archive-tabs button.selected{background:#43866a;color:white}
.archive-date-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
.archive-date-filters label{display:grid;gap:5px;font-size:12px;color:#6c8073;min-width:0}
.archive-date-filters select{width:100%;max-width:100%;min-width:0;min-height:40px;border:1px solid #d9e5dc;border-radius:9px;padding:8px;font-size:13px;background:#fff;color:#344c3c}
.archive-date-filters select:disabled{opacity:.5}
.life-more{display:block;margin:14px auto 0;padding:9px 15px;min-height:40px;border:1px solid #b4d4be;background:#f6faf6;color:#397e59;border-radius:10px;font-size:12px;font-weight:650}
.life-more:disabled{opacity:.6}
@media(max-width:420px){.archive-date-filters{gap:8px}}
</style>
