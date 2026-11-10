<script setup lang="ts">
import DateField from './DateField.vue'
import {computed,ref,watch,nextTick,onBeforeUnmount,onMounted} from 'vue'
import {listLocalPhotos,deleteLocalPhoto,downloadLocalPhoto,compressPhoto} from '../local-media'
import {anniversaryMilestoneLabel} from '../anniversary-milestones.mjs'
import {upcomingWithinDays} from '../today-presentation.mjs'
import FinancePanel from './FinancePanel.vue'
import PlanCreator from './PlanCreator.vue'
import AppIcon from './AppIcon.vue'
import StatusBadge from './StatusBadge.vue'
import {wishTypeLabel} from '../wish-type-display.mjs'
import LifeItemEditor from './LifeItemEditor.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import PhotoThumbnail from './PhotoThumbnail.vue'
import PhotoViewer from './PhotoViewer.vue'
import {invalidatePhoto,setPhotoCacheUser} from '../photo-session-cache'
import {beginPhotoPicker,finishPhotoPicker} from '../photo-picker-foreground.mjs'
import ShoppingLedgerPicker from './ShoppingLedgerPicker.vue'
import ReminderItemEditor from './ReminderItemEditor.vue'
import SwipeActions from './SwipeActions.vue'
import {uniquePlanRows} from '../plan-list-identity.mjs'
import {parseRoutineAssignmentBonus} from '../routine-assignment-validation.mjs'
import {sortPlanTasks} from '../plan-task-sort.mjs'
import {activeSwipeId} from '../swipe-state'
import PageToast from './PageToast.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'
import {usePageToast} from '../page-toast'
import {tripDurationDays,longTripNeedsConfirmation,tripPointsPerPerson,longTripWarning} from '../trip-reward-confirmation.mjs'

const props=defineProps<{mode:'today'|'family'|'plans'|'memories';userId:string;isOwner:boolean;profileRevision:number;profiles:Array<{id:string;displayName:string;type:string;memberUserId?:string|null}>;members?:Array<{id:string;loginName:string;role?:string}>;tasks?:Record<string,any>[];focusPlanType?:string;focusPlanId?:string;focusPlanPeriodKey?:string;focusPlanScope?:'active'|'history';focusPlanFromToday?:boolean;focusPlanRequest?:number;openPlanCreator?:boolean;syncRevision?:number}>()
const emit=defineEmits<{editProfile:[id:string];tasksChanged:[];openPlans:[kind:string,id?:string,periodKey?:string,done?:boolean];backToToday:[];clearPlanFocus:[];planFocusSettled:[requestId:number]}>()
const {toast,notify,clear:clearToast}=usePageToast()
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
watch(()=>props.mode,clearToast)
type Row=Record<string,any>
type GoalPeriodArchive={goalId:string;title:string;goalMode:'monthly'|'yearly';periodKey:string;periodStart:string;periodEnd:string;targetAmount:number;actualAmount:number|null;differenceAmount:number|null;status:'pending'|'met'|'shortfall';settledAt:string|null}
const items=ref<Row[]>([]),other=ref<Row[]>([]),goals=ref<Row[]>([]),trips=ref<Row[]>([]),routines=ref<Row[]>([])
const error=ref(''),busy=ref(false),pushBusyId=ref(''),pushTarget=ref(''),pushMessage=ref(''),pushError=ref('')
const listLoading=ref(false)
// Keep the current plan list mounted while a refresh is pending, including when
// an editor closes or another household member triggers a sync.
const planListReady=ref(false)
let lastPlanQueryKey=''
let activeFetch=0
// A deep link may refresh more than once while remote revisions synchronize.
// Only the first successful focus for this navigation is allowed to scroll.
let lastFocusedScrollKey=''
type PlanType='all'|'routine'|'unscheduled'|'shopping'|'wish'|'goal'|'trip'
const planType=ref<PlanType>('all')
type ReminderKind='task'|'routine'|'shopping'|'trip'
const reminderTarget=ref<{kind:ReminderKind;id:string}|null>(null)
const expandedTaskMenu=ref<string|null>(null)
const routineAssignTarget=ref<{id:string;title:string;periodOn:string}|null>(null)
const routineAssignMember=ref(''),routineAssignSecond=ref(''),routineAssignBonus=ref<string|number>(''),routineAssignBusy=ref(false),routineAssignError=ref('')
function assignedMembers(a:Row|null|undefined,primary:string|null|undefined){
 const first=a?.assigneeUserId||primary||''
 const second=a?.secondAssigneeUserId||''
 return [first,second].filter(Boolean)
}
function canCompleteAssigned(first?:string|null,second?:string|null){
 return !first||first===props.userId||second===props.userId
}
function routineCompletable(r:Row){
 const a=r.currentAssignment||r.nextAssignment
 return canCompleteAssigned(a?.assigneeUserId||r.assigned_to,a?.secondAssigneeUserId)
}
function taskCompletable(t:Row){
 return canCompleteAssigned(t.assigneeUserId,t.secondAssigneeUserId)
}
function shoppingCompletable(s:Row){
 return canCompleteAssigned(s.assigned_to,s.second_assignee_user_id)
}
async function confirmShopping(s:Row){
 if(busy.value||!s.ledger_entry_id||s.completed_at||!shoppingCompletable(s))return
 await update(()=>api('/shopping/'+s.id+'/confirm','POST'),'购物已确认，积分已发放')
 if(!error.value)emit('tasksChanged')
}
function routineAssignmentPeriod(r:Row){
 return String(r.currentPeriodOn||r.nextDueOn||r.earlyPeriodOn||'')
}
async function openRoutineAssignment(r:Row){
 const periodOn=routineAssignmentPeriod(r)
 if(!periodOn||r.visibility!=='household'||!canEdit(r))return
 routineAssignTarget.value={id:r.id,title:r.title,periodOn}
 routineAssignMember.value='';routineAssignSecond.value='';routineAssignBonus.value='';routineAssignError.value='';expandedTaskMenu.value=null
 try{
  const result=await api('/routines/'+r.id+'/assignment?on='+encodeURIComponent(periodOn))
  if(routineAssignTarget.value?.id!==r.id)return
  routineAssignMember.value=result.assignment?.assigneeUserId||''
  routineAssignSecond.value=result.assignment?.secondAssigneeUserId||''
  routineAssignBonus.value=result.assignment?.bonusPoints?String(result.assignment.bonusPoints):''
 }catch(e){routineAssignTarget.value=null;notify('读取本期指派失败：'+(e as Error).message)}
}
function routineAssignMemberChanged(){
 routineAssignError.value=''
 if(!routineAssignMember.value||routineAssignSecond.value===routineAssignMember.value)routineAssignSecond.value=''
 if(routineAssignSecond.value||!routineAssignMember.value||routineAssignMember.value===props.userId)
   routineAssignBonus.value=''
}
async function saveRoutineAssignment(){
 const item=routineAssignTarget.value
 if(!item||routineAssignBusy.value)return
 // Validate explicitly: iOS native required validation can silently block submit in a sheet.
 const other=!!((routineAssignMember.value&&routineAssignMember.value!==props.userId)||
   (routineAssignSecond.value&&routineAssignSecond.value!==props.userId))
 // Vue v-model on an input[type=number] produces a number at runtime.
 // Calling .trim() on that number used to throw before the request began.
 const parsedBonus=parseRoutineAssignmentBonus(routineAssignBonus.value,other&&!routineAssignSecond.value)
 if(!parsedBonus.valid){
  routineAssignError.value='仅指定一名其他家人时，请填写 1～10000 的额外奖励积分';return
 }
 const bonus=parsedBonus.bonus
 if(routineAssignSecond.value&&routineAssignSecond.value===routineAssignMember.value){
  routineAssignError.value='两位处理人不能相同';return
 }
 routineAssignBusy.value=true;routineAssignError.value=''
 try{
  const result=await api('/routines/'+item.id+'/assignment','POST',{
   periodOn:item.periodOn,assigneeUserId:routineAssignMember.value||null,
   secondAssigneeUserId:routineAssignSecond.value||null,bonusPoints:bonus
  })
  routineAssignTarget.value=null
  notify(result?.unchanged?'这一期的指派没有变化':other?'本期指派已保存，已安排专属提醒':'本期处理人已更新')
  emit('tasksChanged')
  void fetchMode()
 }catch(e){
  const code=(e as Error).message
  const hints:Record<string,string>={
   insufficient_points_or_period_resolved:'家庭可用积分不足，或本期已完成／跳过',
   positive_integer_bonus_required:'仅指定一名其他家人时，额外奖励积分必须大于 0',
    dual_assignee_bonus_not_allowed:'两人共同处理时不支持额外奖励积分',
   period_expired:'本期已过期，无法再指派',
   period_already_resolved:'本期已经完成或跳过，无法再指派',
   invalid_period:'本期日期已变化，请重新打开指派',
   forbidden:'只有发布人可以指派',
   recipient_not_in_household:'所选处理人不在家庭中',
   invalid_assignee:'处理人无效，请重新选择'
  }
  routineAssignError.value=hints[code]||'保存失败：'+code
 }finally{routineAssignBusy.value=false}
}
function openTaskPush(kind:'task'|'routine'|'shopping',item:Row){
 const key=kind+':'+item.id
 if(pushTarget.value===key){pushTarget.value='';pushMessage.value=''}
 else {pushTarget.value=key;pushMessage.value=''}
 pushError.value=''
 expandedTaskMenu.value=null
}
function closeTaskPush(){
 if(pushBusyId.value)return
 pushTarget.value='';pushMessage.value='';pushError.value=''
}
async function notifyHandler(kind:'task'|'routine'|'shopping',item:Row){
 if(pushBusyId.value)return
 pushBusyId.value=item.id;pushError.value=''
 try{
  const response=await fetch('/api/push/send-task',{method:'POST',
   credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},
   body:JSON.stringify({kind,id:item.id,message:pushMessage.value.trim(),
    ...(kind==='routine'&&(item.currentAssignment?.assigneeUserId||item.nextAssignment?.assigneeUserId)?
      {periodOn:routineAssignmentPeriod(item)}:{})})})
  const data=await response.json().catch(()=>({}))
  if(!response.ok||data.ok===false){
   const hints:Record<string,string>={
    task_not_shareable:'本期指派可能已变化，请重新打开任务核对处理人和日期',
    recipient_is_self:'没有其他可通知的处理人',
    recipient_not_subscribed:'处理人尚未启用设备推送',
    push_rate_limited:'刚发送过此任务，请稍后再试',
    push_not_configured:'设备推送尚未配置',
    not_authenticated:'登录已失效，请重新登录',
    origin_forbidden:'安全验证未通过，请从 HomeFlow 应用中重新打开',
    invalid_input:'任务参数无效，请重新打开再试',
    notification_inbox_unavailable:'无法写入今日通知，请稍后重试',
    server_error:'服务器暂时发生错误'
   }
   const code=String(data.error||'http_'+response.status)
   throw Error((hints[code]||'任务通知发送失败')+'（'+code+'）')
  }
  pushTarget.value='';pushMessage.value='';pushError.value=''
  if(data.inAppOnly||Number(data.sent||0)===0){
   notify(Number(data.failed||0)>0?
    '已保存至对方今日通知，但设备推送失败（'+data.failed+' 台）':
    '已保存至对方今日通知；尚未成功推送至设备')
  }else notify('已通知处理人（'+data.sent+' 台设备）')
 }catch(e){
  pushError.value=(e as Error).message||'通知发送失败，请重试'
  notify(pushError.value,'error')
 }finally{pushBusyId.value=''}
}
function toggleTaskMenu(key:string){
 // A row never exposes both swipe edit/delete and the contextual menu.
 activeSwipeId.value=''
 expandedTaskMenu.value=expandedTaskMenu.value===key?null:key
}
function toggleReminderEditor(kind:ReminderKind,id:string){
 const old=reminderTarget.value
 reminderTarget.value=old?.kind===kind&&old.id===id?null:{kind,id}
}
function planRequestKinds(type:PlanType){
 if(type==='routine')return ['routines','tasks']
 if(type==='unscheduled')return ['tasks','shopping']
 if(type==='wish')return ['wishes','goals']
 if(type==='goal')return ['goals']
 if(type==='shopping')return ['shopping']
 if(type==='trip')return ['trips']
 return ['wishes','goals','shopping','trips','routines','tasks']
}
function selectPlanType(type:PlanType){
 if(type===planType.value)return
 expandedTaskMenu.value=null
 activeSwipeId.value=''
 planType.value=type
 if(type==='unscheduled')planScope.value='active'
 reminderTarget.value=null
 if(props.mode==='plans')void fetchMode()
}
const financeDetail=ref<{kind:'goal'|'trip';id:string}|null>(null)
const goalCompletionMarks=ref<string[]>([])
const focusError=ref('')
const focusedItemId=computed(()=>props.focusPlanScope===planScope.value?(props.focusPlanId||''):'')
const isFocused=(item:Row)=>!!focusedItemId.value&&item.id===focusedItemId.value&&
  (!item.periodOn||!props.focusPlanPeriodKey||item.periodOn===props.focusPlanPeriodKey)
const onceEditing=ref<Row|null>(null)
const onceTitle=ref(''),onceDate=ref(''),onceRemind=ref(true),onceAssignee=ref(''),onceSecondAssignee=ref(''),onceBonus=ref(0),onceVisibility=ref<'private'|'household'>('private')
const eventTitle=ref(''),eventDate=ref(''),eventRepeat=ref('yearly')
const showAnniversaryForm=ref(false)
const showMemoryForm=ref(false)
const anniversaryFilterOpen=ref(false),memoryFilterOpen=ref(false)
const recapFormOpen=ref(false),tripImportOpen=ref(false)
function closeAnniversaryForm(){
  showAnniversaryForm.value=false
  eventTitle.value='';eventDate.value='';eventRepeat.value='yearly'
}
const routineTitle=ref(''),routineRepeat=ref('daily'),intervalDays=ref(30),intervalAnchor=ref('fixed'),routineSubject=ref(''),routineHealthType=ref('')
const wishTitle=ref(''),wishType=ref('trip'),wishBudget=ref(0),wishVisibility=ref('household')
const goalTitle=ref(''),goalAmount=ref(100000),goalTarget=ref('')
const shoppingTitle=ref('')
const displayedDay=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,10))
const todayAnniversaries=computed<Row[]>(()=>upcomingWithinDays(items.value,displayedDay.value,30))
type EditableKind='routines'|'anniversaries'|'wishes'|'goals'|'shopping'|'memories'|'trips'
const editing=ref<{kind:EditableKind;item:Row}|null>(null),ledgerPickerId=ref<string|null>(null)
function memberName(id:string|null|undefined){
 if(!id)return '未指派'
 return props.profiles.find(p=>p.memberUserId===id)?.displayName||props.members?.find(m=>m.id===id)?.loginName||(id===props.userId?'我':'家庭成员')
}
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
async function shoppingLinksChanged(){
 // Receipt changes can move the item between active and history immediately.
 // Refresh only the shopping category, preserving other plans and ledger picker state.
 const id=ledgerPickerId.value
 if(!id)return
 const scope=planScope.value,requestId=activeFetch
 try{
  const data=await api('/shopping/'+encodeURIComponent(id))
  if(!data.item)throw Error('购物计划不存在')
  if(props.mode!=='plans'||planScope.value!==scope||requestId!==activeFetch)return
  const completed=!!data.item.completed_at
  const belongsHere=scope==='history'?completed:!completed
  if(belongsHere){
   const idx=other.value.findIndex(x=>x.id===id)
   if(idx>=0)other.value.splice(idx,1,data.item)
   else await fetchMode()
  }else{
   // Refill the first five server-paginated entries after moving this record.
   other.value=other.value.filter(x=>x.id!==id)
   const path=listPath('shopping')
   const page=await api(path)
   if(props.mode!=='plans'||planScope.value!==scope||
      requestId!==activeFetch||path!==listPath('shopping'))return
   assignRows('shopping',page.items||[])
   listCursors.value.shopping=page.nextCursor||null
  }
  notify('购物账单关联已更新')
 }catch(e){error.value=(e as Error).message}
}
async function toggleAnniversaryArchive(item:Row){
  const synthetic=item.source==='profile_birthday'
  if(!(synthetic?canEditBirthday(item):canEdit(item))||busy.value)return
  const restoring=!!item.archived_at
  if(!restoring&&!await confirmAction({title:'归档重要日子',confirmLabel:'确认归档',
   message:'归档后不再提醒，但记录会保留在「过去的日子」。确定归档吗？'}))return
  busy.value=true;error.value=''
  try{
    await api('/anniversaries/'+item.id+'/'+(restoring?'restore':'archive'),'POST')
    editing.value=null
    const next=restoring?'upcoming':'past'
    if(anniversaryView.value!==next)anniversaryView.value=next
    else await fetchMode()
    notify(restoring?'已恢复纪念日':'已归档，历史记录已保留')
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function removeItem(kind:EditableKind,item:Row){
 if(!canEdit(item))return
 const warning=kind==='memories'?'回忆进入回收站后暂时保留云端照片以便恢复；永久清空回收站时将删除 R2 中的照片。本机未同步照片需自行清理。':
   kind==='routines'?'删除定期计划？以前的完成记录会保留。':'确定删除这条记录吗？'
 if(!await confirmAction({title:'删除记录',confirmLabel:'确认删除',danger:true,message:warning}))return
 await update(()=>api('/'+kind+'/'+item.id,'DELETE'),'已删除')
 if(!error.value){editing.value=null;if(kind==='trips'&&tripDetail.value?.id===item.id)tripDetail.value=null}
}
const jstDate=(timestamp:string)=>{
 const iso=timestamp.includes('T')?timestamp:timestamp.replace(' ','T')+'Z'
 const time=Date.parse(iso)
 return Number.isFinite(time)?new Date(time+9*3600000).toISOString().slice(0,10):''
}
const planScope=ref<'active'|'history'>(props.focusPlanScope||'active')
type HistoryOutcome='all'|'completed'|'skipped'|'missed'
const planOutcome=ref<HistoryOutcome>('completed')
type SkippedTodayAction={kind:'task'|'shopping'|'wish'|'goal'|'trip';id:string;title:string;originalOn:string;actedAt:string}
const skippedTodayActions=ref<SkippedTodayAction[]>([]),skippedActionCursor=ref<string|null>(null),skippedActionBusy=ref(false)
function skippedActionPath(cursor?:string|null){
 const q=new URLSearchParams({limit:'5'})
 if(['shopping','wish','goal','trip'].includes(planType.value))q.set('kind',planType.value)
 else if(planType.value==='routine')q.set('kind','task')
 if(planYear.value){q.set('year',planYear.value);if(planMonth.value)q.set('month',planMonth.value)}
 if(cursor)q.set('cursor',cursor)
 return '/plans/action-history?'+q.toString()
}
async function loadMoreSkippedActions(){
 if(!skippedActionCursor.value||skippedActionBusy.value)return
 const cursor=skippedActionCursor.value,path=skippedActionPath(cursor)
 skippedActionBusy.value=true
 try{
   const data=await api(path)
   if(props.mode==='plans'&&planScope.value==='history'&&path===skippedActionPath(cursor)){
     skippedTodayActions.value=[...skippedTodayActions.value,...(data.items||[])]
     skippedActionCursor.value=data.nextCursor||null
   }
 }catch(e){error.value=(e as Error).message}
 finally{skippedActionBusy.value=false}
}
function changePlanScope(value:'active'|'history'){
  if(planScope.value===value)return
  planScope.value=value
  // Explicit tab navigation ends the focused deep-link session.
  if(props.focusPlanId)emit('clearPlanFocus')
}
// Task history is independently paginated; the dashboard task snapshot is not an archive.
const oneTimePlans=ref<Row[]>([])
function linkedGoal(w:Row){return w.linkedGoal||goals.value.find(g=>g.wish_id===w.id)}
function toggleFinance(kind:'goal'|'trip',id:string){
  financeDetail.value=financeDetail.value?.kind===kind&&financeDetail.value.id===id?null:{kind,id}
}
async function planCreated(kind:PlanType,id:string,unscheduled=false){
  // An undated one-off task is an inbox item, not a recurring schedule.
  planType.value=unscheduled?'unscheduled':kind==='routine'?'all':kind
  if(unscheduled&&planScope.value!=='active')planScope.value='active'
  else await fetchMode()
  notify(unscheduled?'已添加到待安排': '计划已创建'+(kind==='wish'?'，如已选择储值计划则自动关联':''))
}
function editOnce(t:Row){
  onceEditing.value=onceEditing.value?.id===t.id?null:t
  onceTitle.value=t.title;onceDate.value=t.dueOn||'';onceRemind.value=t.remindEnabled!==0;onceAssignee.value=t.assigneeUserId||'';onceSecondAssignee.value=t.secondAssigneeUserId||'';onceBonus.value=t.secondAssigneeUserId?0:Number(t.bonusPoints||0);onceVisibility.value=t.visibility
}
async function onceChange(t:Row,payload:Record<string,unknown>,method='PATCH'){
  await update(()=>api('/tasks/'+t.id,method,payload),method==='DELETE'?'已删除':'已保存')
  emit('tasksChanged')
}
async function saveOnce(){
  const t=onceEditing.value
  if(!t)return
  await onceChange(t,{title:onceTitle.value,notes:t.notes||'',visibility:onceVisibility.value,
    dueOn:onceDate.value||null,assigneeUserId:onceAssignee.value||null,
    secondAssigneeUserId:onceSecondAssignee.value||null,
    bonusPoints:onceVisibility.value==='household'&&onceAssignee.value&&!onceSecondAssignee.value&&onceAssignee.value!==props.userId?onceBonus.value:0,
    subjectProfileId:t.subjectProfileId||null,healthRecordType:t.healthRecordType||null,
    remindEnabled:onceRemind.value,expectedUpdatedAt:t.updatedAt})
  if(!error.value)onceEditing.value=null
}
async function scheduleUnplanned(t:Row){
 await onceChange(t,{title:t.title,notes:t.notes||'',visibility:t.visibility,dueOn:today(),
   assigneeUserId:t.assigneeUserId||null,secondAssigneeUserId:t.secondAssigneeUserId||null,bonusPoints:t.secondAssigneeUserId?0:Number(t.bonusPoints||0),subjectProfileId:t.subjectProfileId||null,
   healthRecordType:t.healthRecordType||null,remindEnabled:t.remindEnabled!==false,
   expectedUpdatedAt:t.updatedAt})
}
async function deleteOnce(t:Row){
  if(!await confirmAction({title:'删除一次性计划',confirmLabel:'确认删除',danger:true,
    message:'删除这项一次性计划吗？'}))return
  await onceChange(t,{},'DELETE')
}
watch(()=>props.focusPlanType,type=>{
  if(type==='task'||type==='routine')planType.value='all'
  else if(['unscheduled','shopping','wish','goal','trip'].includes(type||''))planType.value=type as PlanType
},{immediate:true})
watch(()=>props.focusPlanRequest,()=>{
  if(props.mode!=='plans'){
    if((props.mode==='memories'&&props.focusPlanType==='memory')||
       (props.mode==='family'&&props.focusPlanType==='anniversary'))void fetchMode()
    return
  }
  const requested=props.focusPlanScope||'active'
  if(planScope.value!==requested)planScope.value=requested
  else void fetchMode()
})

// History defaults to the current JST calendar month; never fetch all years initially.
const planYear=ref(today().slice(0,4)),planMonth=ref(today().slice(5,7))
const memoryYear=ref(''),memoryMonth=ref('')
const yearOptions=Array.from({length:16},(_,i)=>String(Number(today().slice(0,4))-i))
const monthOptions=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))
const recapYear=ref(today().slice(0,4)),recapMonth=ref(today().slice(5,7))
const recap=ref<null|{month:string;total:number;counts:Record<string,number>;note:string}>(null)
const recapBusy=ref(false),recapError=ref('')
const recapLabels:Record<string,string>={tasks:'一次性任务',routines:'定期事项',shopping:'购物计划',wishes:'实现心愿',savings:'储值核验',trips:'完成旅行'}
async function loadRecap(){
 if(recapBusy.value)return
 recapBusy.value=true;recapError.value='';recap.value=null
 try{
  const data=await api('/plans/summary?month='+encodeURIComponent(recapYear.value+'-'+recapMonth.value))
  recap.value=data
  recapFormOpen.value=false
 }catch(e){recapError.value=(e as Error).message}
 finally{recapBusy.value=false}
}
watch([recapYear,recapMonth],()=>{recap.value=null;recapError.value=''})
const historicalGoalPeriods=ref<GoalPeriodArchive[]>([])
const historicalGoalDetail=ref<{goal:Row;periodKey:string}|null>(null)
const historicalGoalDetailLoading=ref('')
let historicalGoalDetailRequest=0
const historicalGoalCursor=ref<string|null>(null),historicalGoalBusy=ref(false)
const listCursors=ref<Record<string,string|null>>({})
const pageBusy=ref<Record<string,boolean>>({})
const pageLimit=5
const anniversaryVisibleCount=ref(pageLimit)
const todayAnniversaryVisibleCount=ref(pageLimit)
const anniversaryView=ref<'upcoming'|'past'>('upcoming')
const anniversaryYear=ref(''),anniversaryMonth=ref('')
// The same shared "items" ref also stores Today's, Plans' and Memories' rows.
// Never render it under a different anniversary tab while its request is pending.
const anniversaryLoadedKey=ref('')
function anniversaryRequestPath(){
  return anniversaryView.value==='past'?listPath('anniversaries'):'/anniversaries/upcoming'
}
const anniversaryExpectedKey=computed(()=>props.userId+'|'+anniversaryRequestPath())
const anniversaryRowsReady=computed(()=>anniversaryLoadedKey.value===anniversaryExpectedKey.value)
const upcomingAnniversaries=computed(()=>{
  if(!anniversaryRowsReady.value)return []
  return anniversaryView.value==='past'?items.value:
    items.value.slice(0,anniversaryVisibleCount.value)
})
const visibleShopping=computed(()=>other.value)
const taskPage=ref(0)
const taskRows=computed(()=>sortPlanTasks(
  planType.value==='unscheduled'?[]:routines.value,oneTimePlans.value,planScope.value))
const visibleTaskRows=computed(()=>taskRows.value.slice(taskPage.value*pageLimit,(taskPage.value+1)*pageLimit))
const canNextTaskPage=computed(()=>taskRows.value.length>(taskPage.value+1)*pageLimit||
  !!listCursors.value.tasks||(planType.value!=='unscheduled'&&!!listCursors.value.routines))

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
    q.set('scope',planType.value==='unscheduled'&&['tasks','shopping'].includes(kind)?'unscheduled':planScope.value)
    if(planScope.value==='history'){
      q.set('outcome',planOutcome.value)
      if(planYear.value){q.set('year',planYear.value);if(planMonth.value)q.set('month',planMonth.value)}
    }
  }
  if((kind==='routines'||kind==='tasks')&&planScope.value==='active'&&planType.value!=='unscheduled')
    q.set('order','due')
  if(cursor)q.set('cursor',cursor)
  return '/'+(kind==='routines'&&planScope.value==='history'?'routines/period-history':kind)+'?'+q.toString()
}
async function toggleHistoricalGoalPeriod(period:GoalPeriodArchive){
  const key=period.goalId+'|'+period.periodKey
  if(historicalGoalDetail.value?.goal.id===period.goalId&&
      historicalGoalDetail.value.periodKey===period.periodKey){
    historicalGoalDetail.value=null
    return
  }
  if(historicalGoalDetailLoading.value===key)return
  const requestId=++historicalGoalDetailRequest
  historicalGoalDetailLoading.value=key
  historicalGoalDetail.value=null
  try{
    const data=await api('/goals/'+encodeURIComponent(period.goalId))
    if(requestId!==historicalGoalDetailRequest||props.mode!=='plans'||planScope.value!=='history'||
        !historicalGoalPeriods.value.some(x=>x.goalId===period.goalId&&x.periodKey===period.periodKey))return
    if(data.item?.id!==period.goalId)throw Error('未找到本期对应的储值计划')
    historicalGoalDetail.value={goal:data.item,periodKey:period.periodKey}
  }catch(e){
    if(requestId===historicalGoalDetailRequest)error.value=(e as Error).message
  }finally{
    if(requestId===historicalGoalDetailRequest)historicalGoalDetailLoading.value=''
  }
}
function historicalGoalPath(cursor?:string|null){
  const q=new URLSearchParams({limit:String(pageLimit),outcome:planOutcome.value})
  if(planYear.value){q.set('year',planYear.value);if(planMonth.value)q.set('month',planMonth.value)}
  if(cursor)q.set('cursor',cursor)
  return '/goals/period-archive?'+q.toString()
}
async function loadMoreGoalPeriods(){
  const cursor=historicalGoalCursor.value
  if(!cursor||historicalGoalBusy.value||props.mode!=='plans'||planScope.value!=='history')return
  const path=historicalGoalPath(cursor)
  historicalGoalBusy.value=true
  try{
    const data=await api(path)
    if(props.mode!=='plans'||planScope.value!=='history'||path!==historicalGoalPath(cursor))return
    historicalGoalPeriods.value=[...historicalGoalPeriods.value,...(data.items||[])]
    historicalGoalCursor.value=data.nextCursor||null
  }catch(e){error.value=(e as Error).message}
  finally{historicalGoalBusy.value=false}
}
function assignRows(kind:string,rows:Row[],append=false){
  const target=kind==='tasks'?oneTimePlans:kind==='wishes'||kind==='memories'||kind==='anniversaries'?items:
    kind==='goals'?goals:kind==='shopping'?other:kind==='trips'?trips:routines
  target.value=uniquePlanRows(append?[...target.value,...rows]:rows,kind,planScope.value)
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

async function nextTaskPage(){
  if(!canNextTaskPage.value)return
  // Each source is individually ordered by the same due-date rule. Load enough
  // of BOTH streams before advancing, so an unseen urgent item is not skipped.
  const needed=(taskPage.value+2)*pageLimit
  const kinds=planType.value==='unscheduled'?['tasks']:['routines','tasks']
  await Promise.all(kinds.map(async kind=>{
    while((kind==='routines'?routines.value:oneTimePlans.value).length<needed&&
      listCursors.value[kind]&&!pageBusy.value[kind]){
      const before=listCursors.value[kind]
      await loadMore(kind)
      if(before===listCursors.value[kind])break
    }
  }))
  if(taskRows.value.length>(taskPage.value+1)*pageLimit)taskPage.value++
}
function toggleLedger(id:string){ledgerPickerId.value=ledgerPickerId.value===id?null:id;editing.value=null}

function milestone(item:Row){return anniversaryMilestoneLabel(item,displayedDay.value)}
function countdown(date:string){
  const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000)
  if(!Number.isFinite(days))return ''
  return days<=0?'今天':days===1?'明天 · 倒计时 1 天':'倒计时 '+days+' 天'
}
function routineNextDue(r:Row){return String(r.nextDueOn||r.next_due_on||'')}
function canCompleteRoutineEarly(r:Row){return !!r.earlyPeriodOn&&r.enabled!==0}
async function completeRoutineEarly(r:Row){
  if(!canCompleteRoutineEarly(r)||busy.value||!routineCompletable(r))return
  if(!await confirmAction({title:'提前完成定期任务',confirmLabel:'确认完成',
    message:'确认提前完成「'+r.title+'」本期？仅本期归档，下期仍按计划生成。'}))return
  await update(()=>api('/routines/'+r.id+'/mark','POST',
    {date:today(),periodOn:r.earlyPeriodOn,status:'completed',early:true}),'本期已提前完成')
  if(!error.value)emit('tasksChanged')
}
async function completeCurrentRoutine(r:Row,status:'completed'|'skipped'){
 if(status==='completed'&&!routineCompletable(r))return
  if(!r.currentPeriodOn||r.currentStatus!=='pending'||busy.value)return
  if(status==='skipped'&&!await confirmAction({title:'跳过本期',confirmLabel:'确认跳过',danger:true,
    message:'跳过本期？会保留一条历史记录。'}))return
  await update(()=>api('/routines/'+r.id+'/mark','POST',
    {date:today(),periodOn:r.currentPeriodOn,status}),
    status==='completed'?'本期已完成':'本期已跳过')
  if(!error.value)emit('tasksChanged')
}
async function undoRoutineHistory(r:Row){
  if(!r.periodOn||r.status==='missed'||busy.value)return
  if(!await confirmAction({title:'撤销定期任务记录',confirmLabel:'确认撤销',danger:true,
    message:r.periodOn<today()?
      '撤销后本期已过期，将记录为「未完成」，不返回今日待办。对应的自动护理记录也会撤销。确定吗？':
      '撤销这一期的记录？如果日期仍有效，可重新在今日待办勾选。对应的自动护理记录也会撤销。'}))return
  await update(()=>api('/routines/'+r.id+'/mark','POST',
    {date:today(),periodOn:r.periodOn,recordOn:r.markOccurrenceOn||r.periodOn,status:'open'}),'已撤销本期记录')
  if(!error.value)emit('tasksChanged')
}
async function completeOnce(t:Row){
  if(busy.value||t.completedAt||!taskCompletable(t))return
  await update(()=>api('/tasks/'+t.id,'PATCH',{completed:true}),'一次性任务已完成')
  if(!error.value)emit('tasksChanged')
}
function canUndoOnce(t:Row){return canEdit(t)||taskCompletable(t)}
async function undoOnce(t:Row){
  if(!t.completedAt||busy.value||!canUndoOnce(t))return
  const expired=!!t.dueOn&&t.dueOn<today()
  if(!await confirmAction({title:'撤销一次性任务完成',confirmLabel:'确认撤销',danger:true,
    message:expired?
      '撤销后已过计划日期，将记录为「未完成」，不返回今日待办。确定撤销吗？':
      '撤销完成？计划日期仍有效时，将重新回到相应日期的待办。'}))return
  await update(()=>api('/tasks/'+t.id,'PATCH',{completed:false}),
    expired?'已撤销，任务记为未完成':'已撤销完成')
  if(!error.value)emit('tasksChanged')
}
function routineLabel(r:Row){
  const config=(()=>{try{return typeof r.repeat_config==='string'?JSON.parse(r.repeat_config):r.repeat_config||{}}catch{return {}}})()
  if(r.repeat_type==='weekly'&&config.excludeJapaneseHolidays)return '工作日'
  if(r.repeat_type==='weekly')return '每周'+(config.weekdays||[]).map((d:number)=>'日一二三四五六'[d]).join('、')
  if(r.repeat_type==='monthly'){
    if(config.mode==='weekday')return '每月第'+(config.weekNumbers||[]).join('、')+
      '个周'+'日一二三四五六'[config.weekday]
    const dates=Array.isArray(config.days)?config.days:[config.day]
    return '每月'+dates.filter((d:number)=>Number.isInteger(d)).sort((a:number,b:number)=>a-b).join('、')+'日'
  }
  if(r.repeat_type==='interval')return '每'+Number(config.days||0)+'天'+(config.anchor==='completion'?' · 按完成日':'')
  return r.repeat_type==='daily'?'每天':'定期'
}
function profileName(id:string|null|undefined){
  return props.profiles.find(p=>p.id===id)?.displayName||''
}
const routineSubjectIsPet=computed(()=>props.profiles.some(p=>p.id===routineSubject.value&&p.type==='pet'))
watch(routineSubject,id=>{
  routineHealthType.value=props.profiles.some(p=>p.id===id&&p.type==='pet')?'other':''
})
const memoryTitle=ref(''),memoryStory=ref(''),memoryDate=ref(new Date().toISOString().slice(0,10)),memoryVisibility=ref<'private'|'household'>('household')
const planMemoryDraft=ref<null|{
 kind:'wish'|'trip';id:string;title:string;happenedOn:string;story:string;visibility:'private'|'household';sourceVisibility:'private'|'household'
}>(null)
function startPlanMemory(kind:'wish'|'trip',item:Row){
 if(!canEdit(item)||item.status!=='completed')return
 const preferred=kind==='trip'?String(item.end_on||item.endOn||''):''
 const sourceVisibility=item.visibility==='private'?'private':'household'
 planMemoryDraft.value={
  kind,id:item.id,title:item.title+' · 回忆',
  happenedOn:preferred&&preferred<=today()?preferred:today(),story:'',visibility:sourceVisibility,sourceVisibility
 }
}
async function savePlanMemory(){
 const draft=planMemoryDraft.value
 if(!draft||busy.value||!draft.title.trim()||!draft.happenedOn)return
 error.value='';busy.value=true
 try{
  await api('/memories','POST',{
   title:draft.title,story:draft.story,happenedOn:draft.happenedOn,
   linkedType:draft.kind,linkedId:draft.id,visibility:draft.visibility
  })
  planMemoryDraft.value=null
  notify(draft.visibility==='household'?'家庭共享回忆已保存':'私人回忆已保存')
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
const photoFiles=ref<File[]>([]),photos=ref<Record<string,string[]>>({}),localPhotoBlobs=ref<Record<string,Blob[]>>({})
const cloudEnabled=ref(false),cloudPhotos=ref<Record<string,Array<{id:string;uploadedBy:string}>>>({})
const photoCursors=ref<Record<string,string|null>>({})
const photoPageBusy=ref<Record<string,boolean>>({})
const photoVersions=ref<Record<string,number>>({})
type OpenPhoto={kind:'cloud'|'local';src:string;title:string;memoryId:string;id?:string;index?:number;uploadedBy?:string}
const openPhoto=ref<OpenPhoto|null>(null),viewerBusy=ref(false)
const paste=ref(''),importTargetId=ref(''),preview=ref<Row|null>(null),tripDetail=ref<Row|null>(null),tripProgress=ref<Row[]>([])
const convertWishEdit=ref<{id:string;title:string;destination:string}|null>(null)
const tripItemEdit=ref<{id:string;title:string;quantity:number|null}|null>(null)
function tripParticipantNames(item:Row){
 const ids=Array.isArray(item.participants)?item.participants as string[]:[]
 return ids.map(id=>props.profiles.find(p=>p.memberUserId===id&&p.type==='person')?.displayName||
   props.members?.find(m=>m.id===id)?.loginName||'家庭成员').join('、')||'未指定'
}
function tripDays(item:Row){
 return tripDurationDays(String(item.startOn||item.start_on||''),
   String(item.endOn||item.end_on||''))
}
function tripRewardPerPerson(item:Row){return tripPointsPerPerson(tripDays(item))}
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
async function focusExactPlan(requestId:number){
  // A Today deep link must not be re-injected into the opposite tab after a scope switch.
  if(props.focusPlanScope!==planScope.value)return
  const id=props.focusPlanId,kind=props.focusPlanType||''
  const endpoints:Record<string,string>={
    shopping:'shopping',wish:'wishes',goal:'goals',trip:'trips',
    task:'tasks',routine:'routines',memory:'memories',anniversary:'anniversaries'
  }
  const destination=kind==='memory'?'memories':kind==='anniversary'?'family':'plans'
  if(!id||!endpoints[kind]||props.mode!==destination||
    !/^[0-9a-f-]{36}$/i.test(id))return
  const focusKey=[props.focusPlanRequest||0,kind,id,props.focusPlanPeriodKey||'',planScope.value].join(':')
  const settleFocus=()=>{
    if(props.focusPlanFromToday)emit('planFocusSettled',props.focusPlanRequest||0)
  }
  try{
    const response=await api(kind==='routine'&&planScope.value==='history'&&props.focusPlanPeriodKey?
      '/routines/'+encodeURIComponent(id)+'/period?on='+encodeURIComponent(props.focusPlanPeriodKey):
      '/'+endpoints[kind]+'/'+encodeURIComponent(id))
    if(requestId!==activeFetch||props.mode!==destination)return
    const item=kind==='trip'?response.trip:kind==='task'?response.task:response.item
    if(!item?.id)throw Error('找不到对应搜索结果')
    if(kind==='goal'&&planScope.value==='history'&&
        ['monthly','yearly'].includes(item.goal_mode))return settleFocus()
    const target=kind==='task'?oneTimePlans:kind==='routine'?routines:
      kind==='shopping'?other:kind==='goal'?goals:kind==='trip'?trips:items
    // Active plans have one row per plan ID; historical routine occurrences are distinct by period.
    const listed=target.value.some(row=>row.id===item.id&&
      (kind!=='routine'||planScope.value!=='history'||row.periodOn===item.periodOn))
    if(!listed)target.value=uniquePlanRows([item,...target.value],kind==='task'?'tasks':kind==='routine'?'routines':kind,planScope.value)
    if(kind==='wish'){
      for(const related of response.linkedGoals||[]){
        if(!goals.value.some(row=>row.id===related.id))goals.value.push(related)
      }
    }
    if(kind==='goal'){
      goalCompletionMarks.value=Array.isArray(response.completedPeriods)?response.completedPeriods:[]
      financeDetail.value={kind:'goal',id}
    }
    if(kind==='shopping'&&props.isOwner)ledgerPickerId.value=id
    if(kind==='trip'){
      tripDetail.value=response.trip;tripProgress.value=response.progress||[]
    }
    if(kind==='memory')await loadPhotos(requestId)
    if(kind==='task'||kind==='routine'){
      const index=taskRows.value.findIndex(entry=>entry.kind===kind&&entry.item.id===id&&
        (kind!=='routine'||!item.periodOn||entry.item.periodOn===item.periodOn))
      if(index>=0)taskPage.value=Math.floor(index/pageLimit)
    }
    // planListReady must be true before nextTick; otherwise the target row
    // is still behind v-if and the first iOS navigation silently misses it.
    await nextTick()
    if(requestId===activeFetch&&focusedItemId.value===id&&lastFocusedScrollKey!==focusKey){
      window.requestAnimationFrame(()=>{
        if(requestId!==activeFetch||focusedItemId.value!==id||props.focusPlanScope!==planScope.value||
          lastFocusedScrollKey===focusKey)return
        const row=document.getElementById('plan-item-'+id+
          (kind==='routine'&&item.periodOn?'-'+item.periodOn:''))
        if(!row){
          focusError.value='已打开计划列表，但未找到需要定位的记录'
          settleFocus()
          return
        }
        lastFocusedScrollKey=focusKey
        // Exactly once per Today deep link; sync/edit refreshes must not yank
        // the user back to the top of the plan list.
        window.scrollTo({top:Math.max(0,row.getBoundingClientRect().top+window.scrollY-176),behavior:'instant'})
        settleFocus()
      })
    }else if(requestId===activeFetch){
      settleFocus()
    }
  }catch(e){
    if(requestId===activeFetch){
      focusError.value=(e as Error).message
      settleFocus()
    }
  }
}
async function finishWish(w:Row){
  if(busy.value)return
  // Target date is for scheduling, not a prerequisite to achieving a wish.
  const completing=w.status!=='completed'
  busy.value=true;error.value=''
  try{
    await api('/plans/complete','POST',{kind:'wish',id:w.id,completed:completing})
    if(completing&&planScope.value!=='history')planScope.value='history'
    else if(!completing&&planScope.value!=='active')planScope.value='active'
    else await fetchMode()
    notify(completing?'已验证条件并完成心愿':'心愿已恢复为进行中')
  }catch(e){
    const code=(e as Error).message
    error.value=code==='goal_not_funded'?'关联储值未达标，请先核对记账本收支和调整额。':
      code==='ledger_verification_unavailable'?'家計簿联动暂不可用，心愿没有被标记完成。':
      code==='owner_required_for_ledger_verification'?'关联储值需家庭管理员核验。':code
  }finally{busy.value=false}
}
async function goalFinished(completed:boolean,periodKey:string){
  const nextScope=periodKey==='once'?(completed?'history':'active'):planScope.value
  if(planScope.value!==nextScope)planScope.value=nextScope
  else await fetchMode()
  notify('本期储值核验结果已更新。')
}
async function fetchMode(){
  const requestId=++activeFetch
  const currentMode=props.mode
  if(currentMode!=='family')anniversaryLoadedKey.value=''
  error.value=''
  focusError.value=''
  listLoading.value=true
  // Do not clear the plan rows before the request: removing the entire list
  // collapses document height and makes iOS Safari snap to the page top.
  if(currentMode==='memories'){
    items.value=[]
    photos.value={};cloudPhotos.value={};localPhotoBlobs.value={}
    photoCursors.value={}
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
      const path=anniversaryRequestPath()
      const loadedKey=props.userId+'|'+path
      const data=await api(path)
      if(requestId!==activeFetch||props.mode!=='family'||loadedKey!==anniversaryExpectedKey.value)return
      items.value=data.items||[]
      anniversaryLoadedKey.value=loadedKey
      listCursors.value.anniversaries=past?data.nextCursor||null:null
      await focusExactPlan(requestId)
    }else if(props.mode==='plans'){
      // Only read the category that the user actually opened. The full view
      // still fetches all six; wishes also need goals for linked funding labels.
      const selected=planType.value
      const queryKey=[selected,planScope.value,planYear.value,planMonth.value,planOutcome.value].join('|')
      const previousTaskPage=queryKey===lastPlanQueryKey?taskPage.value:0
      const kinds=planRequestKinds(selected).filter(kind=>
        planScope.value!=='history'||planOutcome.value==='all'||planOutcome.value==='completed'||
        (planOutcome.value==='skipped'&&kind==='routines')||
        (planOutcome.value==='missed'&&kind!=='shopping'))
      const paths=kinds.map(kind=>listPath(kind))
      const goalArchivePath=planScope.value==='history'&&planOutcome.value!=='skipped'&&
        ['all','goal'].includes(selected)?historicalGoalPath():null
      const actionPath=planScope.value==='history'&&['all','skipped'].includes(planOutcome.value)?
        skippedActionPath():null
      // A failing category must not make every completed shared plan disappear.
      // Display successful household-visible categories and surface a retry hint.
      const results=await Promise.allSettled([...paths.map(path=>api(path)),
        ...(goalArchivePath?[api(goalArchivePath)]:[]),
        ...(actionPath?[api(actionPath)]:[])])
      const pages=results.map(result=>result.status==='fulfilled'?result.value:{items:[],nextCursor:null})
      let failed=results.filter(result=>result.status==='rejected').length
      // A routine/task edit must not silently send the user back to page one.
      // Restore the required server pages only when the filters are unchanged.
      if(previousTaskPage>0){
        const needed=(previousTaskPage+1)*pageLimit
        const extra=await Promise.allSettled(kinds.map(async(kind,i)=>{
          if(kind!=='tasks'&&kind!=='routines'||results[i].status!=='fulfilled')return
          while(pages[i].nextCursor&&(pages[i].items||[]).length<needed){
            const data=await api(listPath(kind,pages[i].nextCursor))
            pages[i]={items:[...(pages[i].items||[]),...(data.items||[])],
              nextCursor:data.nextCursor||null}
          }
        }))
        failed+=extra.filter(result=>result.status==='rejected').length
      }
      if(requestId!==activeFetch||props.mode!=='plans'||selected!==planType.value||
         paths.some((path,i)=>path!==listPath(kinds[i]))||
         (goalArchivePath!==null&&goalArchivePath!==historicalGoalPath()))return
      // Replace the data only after the new response is ready; categories not
      // requested by this filter must not leave stale entries behind.
      const requested=new Set(kinds)
      for(const kind of ['wishes','goals','shopping','trips','routines','tasks']){
        if(!requested.has(kind))assignRows(kind,[])
      }
      listCursors.value={}
      kinds.forEach((kind,i)=>{
        assignRows(kind,pages[i].items||[])
        listCursors.value[kind]=pages[i].nextCursor||null
      })
      taskPage.value=Math.min(previousTaskPage,
        Math.max(0,Math.ceil(taskRows.value.length/pageLimit)-1))
      lastPlanQueryKey=queryKey
      historicalGoalPeriods.value=goalArchivePath?pages[kinds.length].items||[]:[]
      historicalGoalCursor.value=goalArchivePath?pages[kinds.length].nextCursor||null:null
      const actionIndex=kinds.length+(goalArchivePath?1:0)
      skippedTodayActions.value=actionPath?pages[actionIndex].items||[]:[]
      skippedActionCursor.value=actionPath?pages[actionIndex].nextCursor||null:null
      if(failed)error.value='部分计划记录读取失败，请稍后重试或切换分类查看'
      // Reveal the rows before focusExactPlan waits for their DOM nodes.
      // On the first navigation they were previously still hidden behind
      // v-if="planListReady", making the scroll occasionally land at page top.
      planListReady.value=true
      await nextTick()
      if(requestId===activeFetch)await focusExactPlan(requestId)
    }else if(props.mode==='memories'){
      const path=listPath('memories')
      const data=await api(path)
      if(requestId!==activeFetch||props.mode!=='memories'||path!==listPath('memories'))return
      items.value=data.items||[]
      listCursors.value.memories=data.nextCursor||null
      await loadPhotos(requestId)
      await focusExactPlan(requestId)
    }
  }catch(e){if(requestId===activeFetch)error.value=(e as Error).message;return false}
  finally{
    if(requestId===activeFetch){
      listLoading.value=false
      if(currentMode==='plans')planListReady.value=true
    }
  }
  return requestId===activeFetch
}
defineExpose({refreshForSync:()=>fetchMode()})
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
  if(!error.value)closeAnniversaryForm()
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
async function addShopping(){
  await update(()=>api('/shopping','POST',{title:shoppingTitle.value,quantity:1,visibility:'household'}))
  if(!error.value)shoppingTitle.value=''
}
function convertWish(w:Row){
 convertWishEdit.value={id:w.id,title:w.title,destination:w.title};error.value=''
}
async function submitConvertWish(){
 const draft=convertWishEdit.value
 if(!draft||busy.value||!draft.destination.trim())return
 await update(()=>api('/wishes/'+draft.id+'/start-trip','POST',
  {title:draft.title,destination:draft.destination.trim()}))
 if(!error.value)convertWishEdit.value=null
}
async function selectTrip(id:string){
  try{const data=await api('/trips/'+id);tripDetail.value=data.trip;tripProgress.value=data.progress||[]}
  catch(e){error.value=(e as Error).message}
}
function itemDone(externalId:string){return !!tripProgress.value.find(p=>p.itemId===externalId&&p.completedAt)}
const tripItineraryItems=computed(()=>(tripDetail.value?.plan?.trip?.days||[])
  .flatMap((day:Row)=>day.items||[]))
const tripItineraryCompleted=computed(()=>tripItineraryItems.value
  .filter((it:Row)=>itemDone(String(it.externalId))).length)
function tripDisplayTitle(item:Row){
 const title=String(item.title||''),time=String(item.startTime||'')
 return time&&title.startsWith(time)
   ?title.slice(time.length).replace(/^[\s·：:–—-]+/,'').trim():title
}
async function toggleTrip(id:string){
  if(!tripDetail.value)return
  try{
    await api('/trips/'+tripDetail.value.id+'/progress','POST',{itemId:id,completed:!itemDone(id)})
    await selectTrip(tripDetail.value.id)
    notify('旅行事项已更新')
  }catch(e){error.value=(e as Error).message}
}
async function completeTrip(){
 const trip=tripDetail.value
 if(!trip||trip.createdBy!==props.userId||trip.status==='completed'||busy.value)return
 const unfinished=tripItineraryItems.value.length-tripItineraryCompleted.value
 if(!await confirmAction({title:'结束旅行并结算积分',confirmLabel:'确认完成',
   message:unfinished>0
    ?'还有 '+unfinished+' 项行程未勾选，但不影响旅行完成和积分。确定旅行已结束并结算参与人积分吗？'
    :'确定旅行已结束并结算参与人积分吗？'}))return
 const days=tripDays(trip)
 const needsExtraConfirmation=longTripNeedsConfirmation(days)
 if(needsExtraConfirmation&&!await confirmAction({title:'超长旅行二次确认',confirmLabel:'确认结算',
    message:longTripWarning(days)}))return
 busy.value=true;error.value=''
 try{
  await api('/trips/'+encodeURIComponent(trip.id),'PATCH',
    {status:'completed',...(needsExtraConfirmation?{longTripConfirmed:true}:{})})
  tripDetail.value=null
  await fetchMode()
  notify('旅行已完成，参与人积分已结算，可在历史查看')
 }catch(e){const code=(e as Error).message;error.value=code==='trip_not_finished'?'请在旅行结束日期当天或之后确认完成':code==='trip_dates_required_for_completion'?'请先填写旅行的开始和结束日期':code==='trip_reward_insufficient_balance'?'旅行奖励已用于兑换或抽奖，余额不足以撤销本次结算':code==='trip_reward_locked_reopen_first'?'积分已结算，请先撤销完成再修改参与人或旅行日期':code==='trip_long_confirmation_required'?'超过30天的旅行需要再次确认，请重新点击完成':code}
 finally{busy.value=false}
}
function editTripItem(item:Row){
 if(!tripDetail.value||tripDetail.value.createdBy!==props.userId)return
 tripItemEdit.value={id:String(item.externalId),title:String(item.label||item.title),quantity:Number(item.quantity)||null}
 error.value=''
}
async function saveTripItem(){
 const draft=tripItemEdit.value,trip=tripDetail.value
 if(!draft||!trip||busy.value||!draft.title.trim())return
 busy.value=true;error.value=''
 try{
  if(draft.title.trim().length>150)throw Error('名称须为 1～150 个字符')
  const payload={title:draft.title.trim(),...(draft.quantity?{quantity:draft.quantity}:{})}
  await api('/trips/'+trip.id+'/items/'+encodeURIComponent(draft.id),'PATCH',payload)
  await selectTrip(trip.id)
  tripItemEdit.value=null
  notify('修改已保存')
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
async function removeTripItem(item:Row){
  if(!tripDetail.value||tripDetail.value.createdBy!==props.userId||busy.value)return
  if(!await confirmAction({title:'删除旅行明细',confirmLabel:'确认删除',danger:true,
    message:'删除这条旅行明细吗？关联的打勾记录也将清除。'}))return
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
  if(change==='update'&&!await confirmAction({title:'更新现有旅行',confirmLabel:'确认更新',
    message:'会更新原旅行内容，但不会删除已完成事项。确定更新吗？'}))return
  await update(()=>api('/trips/import','POST',{payload:preview.value?.payload,
    visibility:'household',targetTripId:importTargetId.value||null,confirmReplace:change==='update'}))
  if(!error.value){paste.value='';preview.value=null;tripImportOpen.value=false}
}
async function uploadPhoto(memoryId:string,blob:Blob,restoreKey?:string){
  const url='/api/media/upload?memoryId='+encodeURIComponent(memoryId)+
    (restoreKey?'&restoreKey='+encodeURIComponent(restoreKey):'')
  const response=await fetch(url,{
    method:'POST',credentials:'same-origin',
    headers:{'content-type':'image/jpeg'},body:blob
  })
  if(!response.ok){
    const info=await response.json().catch(()=>({error:'photo_upload_failed'}))
    throw Error(String(info.error||'photo_upload_failed'))
  }
  return await response.json() as {id:string;byteSize?:number;reused?:boolean}
}
function previewCloudPhoto(remote:{id:string;uploadedBy:string},memoryId:string,title:string,url:string){
  openPhoto.value={kind:'cloud',id:remote.id,uploadedBy:remote.uploadedBy,
    memoryId,title,src:url}
}
function previewDevicePhoto(memoryId:string,index:number,title:string,url:string){
  openPhoto.value={kind:'local',index,memoryId,title,src:url}
}
async function saveViewedPhoto(blob:Blob){
  const selected=openPhoto.value
  if(!selected||viewerBusy.value)return
  viewerBusy.value=true;error.value=''
  try{
    if(selected.kind==='cloud'&&selected.id){
      const response=await fetch('/api/media/'+encodeURIComponent(selected.id),{
        method:'PUT',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'image/jpeg'},body:blob
      })
      if(!response.ok)throw Error('照片编辑失败，请稍后重试')
      invalidatePhoto(props.userId,selected.id)
      photoVersions.value[selected.id]=(photoVersions.value[selected.id]||0)+1
    }else if(selected.kind==='local'&&selected.index!==undefined){
      await uploadPhoto(selected.memoryId,blob)
      await deleteLocalPhoto(props.userId,selected.memoryId,selected.index)
      await loadPhotos(activeFetch,true)
    }
    openPhoto.value=null
    notify('照片已保存')
  }catch(e){error.value=(e as Error).message}
  finally{viewerBusy.value=false}
}
async function deleteViewedPhoto(){
  const selected=openPhoto.value
  if(!selected||viewerBusy.value)return
  if(!await confirmAction({title:'永久删除照片',confirmLabel:'永久删除',danger:true,
    message:'确定永久删除这张照片吗？删除后无法恢复。'}))return
  viewerBusy.value=true;error.value=''
  try{
    if(selected.kind==='cloud'&&selected.id){
      await api('/media/'+selected.id,'DELETE')
      invalidatePhoto(props.userId,selected.id)
    }else if(selected.kind==='local'&&selected.index!==undefined){
      await deleteLocalPhoto(props.userId,selected.memoryId,selected.index)
    }
    openPhoto.value=null
    await loadPhotos(activeFetch,true)
    notify('照片已删除')
  }catch(e){error.value=(e as Error).message}
  finally{viewerBusy.value=false}
}
async function loadMorePhotos(memoryId:string){
  const cursor=photoCursors.value[memoryId]
  if(!cursor||photoPageBusy.value[memoryId])return
  photoPageBusy.value[memoryId]=true
  try{
    const data=await api('/media?memoryId='+encodeURIComponent(memoryId)+
      '&limit=5&cursor='+encodeURIComponent(cursor))
    if(!items.value.some(m=>m.id===memoryId)||photoCursors.value[memoryId]!==cursor)return
    const existing=cloudPhotos.value[memoryId]||[]
    const seen=new Set(existing.map(photo=>photo.id))
    cloudPhotos.value[memoryId]=[...existing,...(data.items||[])
      .filter((photo:{id:string})=>!seen.has(photo.id))]
    photoCursors.value[memoryId]=data.nextCursor||null
  }catch(e){error.value=(e as Error).message}
  finally{photoPageBusy.value[memoryId]=false}
}
async function uploadAdditionalPhotos(memoryId:string,event:Event){
  // Returning from the native picker is not a page navigation. In particular,
  // cancelling it must not make even a single network request or DOM update.
  finishPhotoPicker()
  const input=event.target as HTMLInputElement
  const files=Array.from(input.files||[]).slice(0,10)
  input.value=''
  if(!files.length||busy.value)return
  if(!cloudEnabled.value){error.value='照片上传暂不可用，请联网后重试。';return}
  busy.value=true;error.value=''
  const uploader=props.userId
  const uploaded:Array<{id:string;uploadedBy:string}>=[]
  const failed:string[]=[]
  try{
    for(const file of files){
      try{
        const created=await uploadPhoto(memoryId,await compressPhoto(file))
        if(!created?.id)throw Error('photo_upload_missing_id')
        uploaded.push({id:created.id,uploadedBy:uploader})
      }catch(e){failed.push(file.name+'：'+(e as Error).message)}
    }
    // Keep all loaded memory pages, cursors, other photos, and scroll position.
    // Successful uploads affect only their own memory; no fetchMode/loadPhotos.
    if(uploaded.length&&props.mode==='memories'&&props.userId===uploader&&
       items.value.some(item=>item.id===memoryId)){
      const existing=cloudPhotos.value[memoryId]||[]
      const known=new Set(existing.map(photo=>photo.id))
      cloudPhotos.value[memoryId]=[...uploaded.filter(photo=>!known.has(photo.id)),...existing]
    }
    if(failed.length)error.value=uploaded.length+' 张成功，'+failed.length+' 张未上传：'+failed.join('；')
    else notify('已上传 '+uploaded.length+' 张照片')
  }finally{busy.value=false}
}
async function syncLocalPhotos(memoryId:string){
  if(!cloudEnabled.value||busy.value)return
  busy.value=true;error.value=''
  let count=0
  try{
    const originals=await listLocalPhotos(props.userId,memoryId)
    for(const blob of originals){
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))
      const marker=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('')
      const compressed=await compressPhoto(new File([blob],memoryId+'.jpg',{type:'image/jpeg'}))
      await uploadPhoto(memoryId,compressed,marker)
      // Only a confirmed R2 upload permits deleting the legacy device copy.
      await deleteLocalPhoto(props.userId,memoryId,0)
      count++
    }
    await loadPhotos(activeFetch,true)
    notify('已同步 '+count+' 张照片')
  }catch(e){
    error.value='已同步 '+count+' 张，剩余旧照片请稍后重试：'+(e as Error).message
    await loadPhotos(activeFetch,true)
  }finally{busy.value=false}
}
async function addMemory(){
  if(!memoryTitle.value.trim()||!memoryDate.value)return
  if(photoFiles.value.length&&!cloudEnabled.value){
    error.value='照片上传暂不可用，请联网后重试。'
    return
  }
  error.value='';busy.value=true
  try{
    const result=await api('/memories','POST',{title:memoryTitle.value,story:memoryStory.value,
      happenedOn:memoryDate.value,visibility:memoryVisibility.value})
    const failedPhotos:string[]=[]
    if(result.id)for(const file of photoFiles.value.slice(0,10)){
      try{
        await uploadPhoto(result.id,await compressPhoto(file))
      }catch(e){
        // No local fallback. Failed originals remain in the iOS Photos app.
        failedPhotos.push(file.name+'：'+(e as Error).message)
      }
    }
    memoryTitle.value='';memoryStory.value='';memoryVisibility.value='household';photoFiles.value=[]
    showMemoryForm.value=false
    await fetchMode()
    if(failedPhotos.length)notify('回忆已保存，'+failedPhotos.length+' 张照片未上传：'+failedPhotos.join('；'),'warning')
    else if(!toast.value)notify('回忆已保存')
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function loadPhotos(requestId=activeFetch,force=false){
  // Photo bytes are fetched only by visible thumbnail components.
  // Metadata is grouped into one D1 request for each five-memory page.
  setPhotoCacheUser(props.userId)
  if(force){
    for(const url of photoUrls)URL.revokeObjectURL(url)
    photoUrls=[];photos.value={};localPhotoBlobs.value={}
    cloudPhotos.value={};photoCursors.value={}
  }
  const missing=items.value.filter(m=>!(m.id in photoCursors.value)).map(m=>m.id)
  if(!missing.length&&items.value.length===0){
    try{
      const status=await api('/media?memoryIds=')
      if(requestId===activeFetch)cloudEnabled.value=!!status.cloudAvailable
    }catch{if(requestId===activeFetch)cloudEnabled.value=false}
  }
  for(let i=0;i<missing.length;i+=5){
    const ids=missing.slice(i,i+5)
    try{
      const page=await api('/media?memoryIds='+ids.map(encodeURIComponent).join(','))
      if(requestId!==activeFetch)return
      cloudEnabled.value=!!page.cloudAvailable
      for(const id of ids){
        cloudPhotos.value[id]=[]
        photoCursors.value[id]=page.nextCursors?.[id]||null
      }
      for(const photo of page.items||[]){
        if(!cloudPhotos.value[photo.memoryId])continue
        cloudPhotos.value[photo.memoryId].push({id:photo.id,uploadedBy:photo.uploadedBy})
      }
    }catch{
      if(requestId!==activeFetch)return
      error.value='部分照片目录读取失败，请稍后重试'
    }
  }
  for(const m of items.value){
    if(requestId!==activeFetch)return
    if(m.created_by!==props.userId||m.id in localPhotoBlobs.value)continue
    try{
      const list=await listLocalPhotos(props.userId,m.id)
      if(requestId!==activeFetch)return
      localPhotoBlobs.value[m.id]=list
      if(!list.length)continue
      photos.value[m.id]=list.map(b=>{const url=URL.createObjectURL(b);photoUrls.push(url);return url})
    }catch{ /* Old device-only albums may be unavailable in Safari private mode. */ }
  }
}

onMounted(()=>document.addEventListener('visibilitychange',refreshOnResume))
onBeforeUnmount(()=>{
  activeFetch++
  for(const x of photoUrls)URL.revokeObjectURL(x)
  document.removeEventListener('visibilitychange',refreshOnResume)
})
watch(()=>[props.mode,props.userId],()=>{openPhoto.value=null})
watch(()=>[props.mode,props.userId,props.profileRevision,props.syncRevision],fetchMode,{immediate:true})
watch([planScope,planType,planYear,planMonth,planOutcome],()=>{
  historicalGoalDetailRequest++
  historicalGoalDetail.value=null
  historicalGoalDetailLoading.value=''
})
watch([planScope,planYear,planMonth,planOutcome],()=>{if(props.mode==='plans')void fetchMode()})
watch([memoryYear,memoryMonth],()=>{if(props.mode==='memories')void fetchMode()})
watch([anniversaryView,anniversaryYear,anniversaryMonth],()=>{
  anniversaryVisibleCount.value=pageLimit
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
 <ConfirmActionSheet v-if="confirmRequest" :request="confirmRequest"
   @confirm="acceptConfirm" @cancel="cancelConfirm"/>

    <template v-if="mode==='today'">
      <!-- Extra reminders are pinned above today's checklist in App.vue; here only anniversaries remain. -->
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="calendar-heart" :size="21" /> 未来 30 天的纪念日</h2>
          <p v-if="listLoading" class="life-empty" role="status">正在读取纪念日…</p>
          <p v-else-if="!todayAnniversaries.length" class="life-empty">未来 30 天暂无纪念日</p>
          <div v-for="e in (listLoading?[]:todayAnniversaries.slice(0,todayAnniversaryVisibleCount))" :key="e.id" class="life-row upcoming-anniversary">
            <div class="anniversary-subject"><b>{{ e.title }}</b>
              <small v-if="milestone(e)" class="anniversary-milestone">{{ milestone(e) }}</small>
            </div>
            <div class="anniversary-countdown">
              <strong>{{ countdown(e.nextOn) }}</strong>
              <time :datetime="e.nextOn">{{ e.nextOn }}</time>
            </div>
          </div>
          <button v-if="todayAnniversaries.length>todayAnniversaryVisibleCount" type="button" class="life-more"
            @click="todayAnniversaryVisibleCount+=pageLimit">加载更多纪念日</button>
        </section>
    </template>

    <template v-else-if="mode==='family'">
      <section class="life-card anniversary-card">
        <div class="life-section-heading">
          <h2 class="life-heading"><AppIcon name="calendar-heart" :size="21" /> 家人的重要日子</h2>
          <button type="button" class="section-add-button" :aria-expanded="showAnniversaryForm"
            aria-controls="new-anniversary-form" :disabled="busy"
            aria-label="添加纪念日" title="添加纪念日"
            @click="showAnniversaryForm=true"><AppIcon name="plus" :size="19" /></button>
        </div>

        <div class="anniversary-controls">
        <div class="archive-tabs" role="group" aria-label="重要日子筛选">
          <button type="button" :class="{selected:anniversaryView==='upcoming'}"
            :aria-pressed="anniversaryView==='upcoming'" @click="anniversaryView='upcoming'">即将到来</button>
          <button type="button" :class="{selected:anniversaryView==='past'}"
            :aria-pressed="anniversaryView==='past'" @click="anniversaryView='past'">过去的日子</button>
        </div>
        <div v-if="anniversaryView==='past'" class="anniversary-filter-row">
          <button type="button" class="life-filter-trigger" :aria-expanded="anniversaryFilterOpen"
            @click="anniversaryFilterOpen=true">
            <span>筛选日期 · {{ anniversaryYear?(anniversaryYear+' 年'+(anniversaryMonth?' · '+Number(anniversaryMonth)+' 月':'')):'全部' }}</span>
            <AppIcon name="chevron-down" :size="15" />
          </button>
        </div>
        </div>
        <EditBottomSheet v-if="anniversaryView==='past'&&anniversaryFilterOpen" title="筛选过去的重要日子" @close="anniversaryFilterOpen=false">
        <div class="archive-date-filters">
          <label>年份<select v-model="anniversaryYear" aria-label="纪念日历史年份">
            <option value="">全部年份</option>
            <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 年</option>
          </select></label>
          <label>月份<select v-model="anniversaryMonth" :disabled="!anniversaryYear" aria-label="纪念日历史月份">
            <option value="">全年</option>
            <option v-for="month in monthOptions" :key="month" :value="month">{{ Number(month) }} 月</option>
          </select></label>
        </div>
        <button class="life-more" type="button" @click="anniversaryFilterOpen=false">完成</button>
        </EditBottomSheet>
        <p v-if="!anniversaryRowsReady&&listLoading" class="life-empty anniversary-empty" role="status">正在读取{{ anniversaryView==='past'?'过去的日子':'即将到来的日子' }}…</p>
        <p v-else-if="anniversaryRowsReady&&!listLoading&&!error&&!upcomingAnniversaries.length" class="life-empty anniversary-empty">
          {{ anniversaryView==='past'?'暂无符合条件的历史重要日子':'暂无即将到来的重要日子' }}
        </p>
        <template v-for="e in upcomingAnniversaries" :key="e.id">
          <div :id="'plan-item-'+e.id" :class="{'focused-plan-entry':isFocused(e)}">
          <SwipeActions :id="e.id" scope="anniversaries"
            :allow-edit="canEdit(e)||canEditBirthday(e)" :allow-delete="canEdit(e)"
            :allow-archive="canEdit(e)||canEditBirthday(e)"
            :archive-label="e.archived_at?'恢复':'归档'"
            @edit="editAnniversary(e)" @archive="toggleAnniversaryArchive(e)"
            @delete="removeItem('anniversaries',e)">
            <div class="life-row"><div class="life-details"><b>{{ e.title }}</b>
              <small>{{ e.nextOn||e.event_date }} <span v-if="e.archived_at" class="anniversary-archived-tag">· 已归档</span></small></div></div>
          </SwipeActions>
          <LifeItemEditor v-if="editing?.kind==='anniversaries'&&editing.item.id===e.id"
            kind="anniversaries" :item="e" @saved="changed" @cancel="editing=null"/>
          </div>
        </template>
        <button v-if="anniversaryView==='upcoming'&&items.length>anniversaryVisibleCount" type="button" class="life-more"
          @click="anniversaryVisibleCount+=pageLimit">加载更多重要日子</button>
        <button v-if="anniversaryView==='past'&&anniversaryRowsReady&&listCursors.anniversaries" type="button" class="life-more"
          :disabled="pageBusy.anniversaries" @click="loadMore('anniversaries')">加载更多历史纪念日</button>
        <EditBottomSheet v-if="showAnniversaryForm" title="添加纪念日" :close-disabled="busy" @close="closeAnniversaryForm">
<form id="new-anniversary-form" class="life-form" @submit.prevent="addAnniversary">
          <input v-model.trim="eventTitle" required placeholder="纪念日名称"/><DateField v-model="eventDate" required />
          <select v-model="eventRepeat"><option value="yearly">每年</option><option value="once">一次性</option><option value="monthly">每月</option></select>
          <button :disabled="busy">添加纪念日</button>
          <button type="button" class="life-cancel" :disabled="busy" @click="closeAnniversaryForm">取消</button>
        </form>
</EditBottomSheet>
      </section>
    </template>

    <template v-else-if="mode==='plans'">
      <p v-if="focusError" role="alert" class="life-error">{{ focusError }} · 请从计划列表手动查找。</p>
      <div class="plan-view-toolbar" aria-label="计划筛选与状态">
        <div class="plan-view-heading">
          <b>计划列表</b>
          <PlanCreator v-if="planScope==='active'" compact
            :profiles="props.profiles" :members="props.members" :user-id="props.userId"
            :open-on-mount="props.openPlanCreator"
            @created="planCreated" @task-created="emit('tasksChanged')"/>
        </div>
        <div class="plan-filter-tabs" role="group" aria-label="按计划类型筛选">
        <button v-for="tab in [
          {id:'all',label:'全部'},{id:'unscheduled',label:'待安排'},{id:'shopping',label:'购物'},
          {id:'wish',label:'心愿'},{id:'goal',label:'储值'},{id:'trip',label:'旅行'}]"
          :key="tab.id" type="button" :class="{selected:planType===tab.id}"
          :aria-pressed="planType===tab.id" @click="selectPlanType(tab.id as PlanType)">
          {{ tab.label }}</button>
      </div>
        <div v-if="planType!=='unscheduled'" class="archive-toolbar">
        <div class="archive-tabs" role="group" aria-label="计划记录筛选">
          <button type="button" :class="{selected:planScope==='active'}" :aria-pressed="planScope==='active'"
            @click="changePlanScope('active')">进行中</button>
          <button type="button" :class="{selected:planScope==='history'}" :aria-pressed="planScope==='history'"
            @click="changePlanScope('history')">已完成／历史</button>
        </div>
        <div v-if="planScope==='history'" class="archive-date-filters plan-history-date-filters" role="group" aria-label="历史计划年月与状态筛选">
          <label>年份
            <select v-model="planYear" aria-label="历史记录年份">
              <option value="">全部年份</option>
              <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 年</option>
            </select>
          </label>
          <label>月份
            <select v-model="planMonth" :disabled="!planYear" aria-label="历史记录月份">
              <option value="">全年</option>
              <option v-for="month in monthOptions" :key="month" :value="month">{{ Number(month) }} 月</option>
            </select>
          </label>
          <label>状态
            <select v-model="planOutcome" aria-label="历史计划状态">
              <option value="completed">已完成</option>
              <option value="skipped">已跳过</option>
              <option value="missed">未完成</option>
              <option value="all">全部状态</option>
            </select>
          </label>
        </div>
      </div>
      </div>
      <p v-if="listLoading&&!planListReady" class="life-caption" role="status">正在读取计划…</p>
      <div v-if="planListReady" class="life-grid" :aria-busy="listLoading" :inert="listLoading">
        <section v-if="planScope==='history'&&(skippedTodayActions.length||skippedActionCursor)"
          class="life-card skipped-action-history">
          <h2 class="life-heading"><AppIcon name="archive" :size="20"/> 跳过记录</h2>
          <div v-for="entry in skippedTodayActions" :key="entry.kind+':'+entry.id+':'+entry.originalOn"
            class="skipped-action-history-row">
            <b>{{ entry.title }}</b>
            <small>{{ ({task:'一次性任务',shopping:'购物',wish:'心愿',goal:'储值',trip:'旅行'})[entry.kind] }} · {{ entry.originalOn }} · <StatusBadge code="skipped" /></small>
          </div>
          <button v-if="skippedActionCursor" type="button" class="outline" :disabled="skippedActionBusy"
            @click="loadMoreSkippedActions">加载更多</button>
        </section>
        <section v-if="planType==='all'||planType==='routine'||(planType==='unscheduled'&&(!visibleShopping.length||visibleTaskRows.length>0))" class="life-card plan-tasks-card">
          <h2 class="life-heading"><AppIcon name="repeat" :size="21" /> {{ planType==='unscheduled'?'待安排事项':'任务／定期计划' }}</h2>

          <template v-for="entry in visibleTaskRows" :key="entry.kind+':'+entry.item.id+':'+(entry.item.periodOn||'')">
          <template v-if="entry.kind==='routine'&&planScope==='history'">
            <div v-for="r in [entry.item]"
              :key="r.id+':'+r.periodOn" :id="'plan-item-'+r.id+'-'+r.periodOn"
              class="plan-task-item routine-history-row" :class="{'focused-plan-entry':isFocused(r)}">
              <div class="plan-task-head">
                <b class="detail-name" :class="{'routine-struck':r.status==='completed'}">{{ r.title }}</b>
                <StatusBadge class="plan-task-status routine-state" :code="r.status" :label="r.status==='missed'?'未完成':undefined" />
              </div>
              <small class="routine-meta">{{ routineLabel(r) }}<template v-if="profileName(r.subject_profile_id)"> · {{ profileName(r.subject_profile_id) }}</template></small>
              <small class="once-task-identity routine-meta">
                <span>发起人：{{ memberName(r.created_by) }}</span>
                <span>处理人：{{ memberName(r.assigned_to) }}</span>
              </small>
              <div class="plan-task-footer">
                <span class="plan-task-next">{{ r.periodOn }} 期<template v-if="r.completedOn"> · 实际 {{ r.completedOn }}</template></span>
                <button v-if="r.status!=='missed'" type="button" class="routine-text-action" :disabled="busy"
                  @click="undoRoutineHistory(r)">撤销</button>
              </div>
              <button v-if="isFocused(r)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
            </div>
          </template>
          <template v-else-if="entry.kind==='routine'">
            <div v-for="r in [entry.item]" :key="r.id"
              :id="'plan-item-'+r.id" class="plan-task-item" data-swipe-item :class="{'focused-plan-entry':isFocused(r)}">
              <SwipeActions :id="r.id" scope="routines" :allow-edit="canEdit(r)" :allow-delete="canEdit(r)"
                @open="expandedTaskMenu=null" @edit="edit('routines',r)" @delete="removeItem('routines',r)">
                <div class="routine-compact">
                  <div class="plan-task-head">
                    <b class="detail-name">{{ r.title }}</b>
                    <div class="plan-task-heading-actions">
                      <StatusBadge v-if="r.currentPeriodOn&&r.currentStatus==='pending'"
                        class="plan-task-status"
                        :code="r.currentPeriodOn<today()?'overdue':'pending'"
                        :label="r.currentPeriodOn<today()?'逾期':'待处理'" />
                      <StatusBadge v-else-if="r.completedToday"
                        class="plan-task-status" code="completed" label="今天已完成" />

                    </div>
                  </div>
                  <div class="routine-description-row">
                    <small class="routine-meta">{{ routineLabel(r) }}<template v-if="profileName(r.subject_profile_id)"> · {{ profileName(r.subject_profile_id) }}</template><template v-if="r.health_record_type"> · 完成后记护理</template><template v-if="r.currentAssignment?.bonusPoints||r.nextAssignment?.bonusPoints"> · 本期额外 {{ r.currentAssignment?.bonusPoints||r.nextAssignment?.bonusPoints }} 分</template></small>
                      <button type="button" class="routine-more-trigger"
                        :aria-label="'更多操作：'+r.title"
                        :aria-expanded="expandedTaskMenu==='routine:'+r.id"
                        :aria-controls="'routine-actions-'+r.id"
                        @click.stop="toggleTaskMenu('routine:'+r.id)">
                        <AppIcon name="ellipsis" :size="19"/>
                      </button>
                  </div>
                  <small class="once-task-identity routine-meta">
                    <span>发起人：{{ memberName(r.created_by) }}</span>
                    <span>处理人：{{ assignedMembers(r.currentAssignment||r.nextAssignment,r.assigned_to).map(memberName).join('、')||'未指派' }}</span>
                  </small>
                  <div class="plan-task-footer">
                    <span class="plan-task-next">
                      {{ r.currentPeriodOn&&r.currentStatus==='pending'&&r.currentPeriodOn<today()?r.currentPeriodOn:'下次 '+(routineNextDue(r)||'待安排') }}
                    </span>
                    <button v-if="r.currentPeriodOn&&r.currentStatus==='pending'&&routineCompletable(r)" type="button" class="routine-text-action"
                      :disabled="busy" @click="completeCurrentRoutine(r,'completed')">完成本期</button>
                    <button v-else-if="canCompleteRoutineEarly(r)&&routineCompletable(r)" type="button" class="routine-text-action"
                      :disabled="busy" @click="completeRoutineEarly(r)">提前完成</button>
                  </div>
                </div>
              </SwipeActions>
              <div v-if="expandedTaskMenu==='routine:'+r.id" :id="'routine-actions-'+r.id"
                class="routine-inline-actions" role="group" :aria-label="'操作：'+r.title"
                @keydown.esc.stop="expandedTaskMenu=null">
                <button v-if="canEdit(r)&&r.visibility==='household'&&routineAssignmentPeriod(r)>=today()"
                  type="button" @click="openRoutineAssignment(r)">指派本期</button>
                <button type="button" @click="expandedTaskMenu=null;toggleReminderEditor('routine',r.id)">提醒设置</button>
                <button v-if="canEdit(r)&&r.visibility==='household'&&
                  (r.currentAssignment?.assigneeUserId||r.nextAssignment?.assigneeUserId||r.assigned_to)&&
                  (r.currentAssignment?.assigneeUserId||r.nextAssignment?.assigneeUserId||r.assigned_to)!==props.userId" type="button"
                  :disabled="!!pushBusyId" @click="openTaskPush('routine',r)">{{ pushBusyId===r.id?'发送中…':'通知处理人' }}</button>
                <button v-if="r.currentPeriodOn&&r.currentStatus==='pending'" type="button"
                  :disabled="busy" @click="expandedTaskMenu=null;completeCurrentRoutine(r,'skipped')">跳过本期</button>
              </div>
              <EditBottomSheet v-if="pushTarget==='routine:'+r.id" title="通知处理人" :close-disabled="!!pushBusyId" @close="closeTaskPush">
<form class="task-push-form" @submit.prevent="notifyHandler('routine',r)">
                <label>给 {{ assignedMembers(r.currentAssignment||r.nextAssignment,r.assigned_to).map(memberName).join('、')||'未指派' }} 留言（可选）
                  <textarea v-model.trim="pushMessage" maxlength="120" rows="2" placeholder="例如：今天方便的话帮我处理一下哦"/>
                </label>
                <p v-if="pushError" role="alert" class="task-push-error">{{ pushError }}</p>
                <div class="task-push-actions">
                  <button type="button" :disabled="!!pushBusyId" @click="closeTaskPush">取消</button>
                  <button type="button" :disabled="!!pushBusyId" :aria-busy="!!pushBusyId"
                   @click.stop="notifyHandler('routine',r)">{{ pushBusyId===r.id?'发送中…':'发送任务通知' }}</button>
                </div>
              </form>
</EditBottomSheet>
              <EditBottomSheet v-if="routineAssignTarget?.id===r.id" title="指派这一期"
                :close-disabled="routineAssignBusy" @close="routineAssignTarget=null">
                <form class="task-push-form routine-assignment-form" novalidate @submit.prevent="saveRoutineAssignment">
                  <div class="routine-assignment-summary"><span>{{ routineAssignTarget?.periodOn||'' }} · 仅影响本期</span><b>{{ r.title }}</b></div>
                  <label>处理人
                    <select v-model="routineAssignMember" aria-label="本期指定处理人"
                      @change="routineAssignMemberChanged">
                      <option value="">未指派（全家均可完成）</option>
                      <option v-for="member in (props.members||[])" :key="member.id" :value="member.id">
                        {{ memberName(member.id) }}{{ member.id===props.userId?'（我）':'' }}
                      </option>
                    </select>
                  </label>
                  <label v-if="routineAssignMember">共同处理人（可选）
                    <select v-model="routineAssignSecond" aria-label="本期第二位处理人" @change="routineAssignMemberChanged">
                      <option value="">仅一人负责</option>
                      <option v-for="member in (props.members||[])" :key="member.id" :value="member.id"
                        :disabled="member.id===routineAssignMember">{{ memberName(member.id) }}</option>
                    </select>
                    <small v-if="routineAssignSecond">两人中任一人完成，双方平分基础积分，不设置额外奖励。</small>
                  </label>
                  <label v-if="routineAssignMember&&!routineAssignSecond&&routineAssignMember!==props.userId">
                    额外奖励积分（由发布人支付）
                    <input v-model.trim="routineAssignBonus" type="number" inputmode="numeric"
                      min="1" max="10000" step="1" required aria-label="本期额外奖励正整数"
                      placeholder="1～10000" :aria-invalid="!!routineAssignError" @input="routineAssignError=''"/>
                  </label>
                  <small v-if="routineAssignMember&&!routineAssignSecond&&routineAssignMember!==props.userId">完成本期基础 +5 分，额外奖励从发布人的家庭积分中预留并转给处理人。</small>
                  <p v-if="routineAssignError" role="alert" class="routine-assignment-error">{{ routineAssignError }}</p>
                  <div class="task-push-actions routine-assignment-actions">
                    <button type="button" :disabled="routineAssignBusy" @click="routineAssignTarget=null">取消</button>
                    <button type="button" :disabled="routineAssignBusy" :aria-busy="routineAssignBusy"
                      @click.stop="saveRoutineAssignment">{{ routineAssignBusy?'保存中…':'保存指派' }}</button>
                  </div>
                </form>
              </EditBottomSheet>
              <ReminderItemEditor v-if="reminderTarget?.kind==='routine'&&reminderTarget.id===r.id"
                kind="routine" :item-id="r.id" @close="reminderTarget=null"/>
              <LifeItemEditor v-if="editing?.kind==='routines'&&editing.item.id===r.id"
                kind="routines" :item="r" :profiles="props.profiles" :members="props.members" :user-id="props.userId" @saved="changed" @cancel="editing=null"/>
              <button v-if="isFocused(r)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
            </div>
          </template>
          <template v-else>
          <div v-for="t in [entry.item]" :key="t.id" :id="'plan-item-'+t.id"
            class="plan-task-item" data-swipe-item :class="{'focused-plan-entry':isFocused(t)}">
            <SwipeActions :id="t.id" scope="one-time-plans" :allow-edit="canEdit(t)" :allow-delete="canEdit(t)"
              @open="expandedTaskMenu=null" @edit="editOnce(t)" @delete="deleteOnce(t)">
              <div class="life-row" :class="{'detail-completed':!!t.completedAt}">
                <div class="life-details">
                  <div class="plan-task-head">
                    <b class="detail-name">{{ t.title }}</b>
                    <div class="plan-task-heading-actions">
                      <StatusBadge class="plan-task-status"
                        :code="t.completedAt?'completed':t.dueOn&&t.dueOn<today()?'missed':t.dueOn?'pending':'unscheduled'"
                        :label="t.completedAt?'已完成':t.dueOn&&t.dueOn<today()?'未完成':t.dueOn?'待处理':'待安排'" />

                    </div>
                  </div>
                  <div class="routine-description-row once-task-description-row">
                    <small class="once-task-summary">一次性任务 · {{ t.dueOn||'无截止日期' }}
                      <template v-if="profileName(t.subjectProfileId)"> · {{ profileName(t.subjectProfileId) }}</template>
                    </small>
                      <button v-if="planScope==='active'&&(!!t.dueOn||(canEdit(t)&&t.visibility==='household'&&t.assigneeUserId&&t.assigneeUserId!==props.userId))" type="button" class="routine-more-trigger"
                        :aria-label="'更多操作：'+t.title"
                        :aria-expanded="expandedTaskMenu==='task:'+t.id"
                        :aria-controls="'task-actions-'+t.id"
                        @click.stop="toggleTaskMenu('task:'+t.id)">
                        <AppIcon name="ellipsis" :size="19"/>
                      </button>
                  </div>
                  <small class="once-task-identity">
                    <span>发起人：{{ memberName(t.creatorUserId) }}</span>
                    <span>处理人：{{ [t.assigneeUserId,t.secondAssigneeUserId].filter(Boolean).map(memberName).join('、')||'未指派' }}</span>
                  </small>
                </div>
              </div>
            <div v-if="planType==='unscheduled'" class="plan-task-footer">
              <div class="plan-task-controls">
                <button type="button" class="plan-task-action" @click="scheduleUnplanned(t)">安排到今天</button>
              </div>
            </div>
            <div v-if="planScope==='active'&&planType!=='unscheduled'" class="plan-task-footer">
              <span class="plan-task-next">{{ t.dueOn?'计划 '+t.dueOn:'尚未安排日期' }}</span>
              <button v-if="!t.completedAt&&t.dueOn&&taskCompletable(t)" type="button" class="routine-text-action"
                :disabled="busy" @click="completeOnce(t)">{{ t.dueOn>today()?'提前完成':'完成' }}</button>
            </div>
            <div v-if="planScope==='history'" class="plan-task-footer">
              <span class="plan-task-next">{{ t.dueOn?'计划 '+t.dueOn:'无截止日期' }}</span>
              <button v-if="t.completedAt&&canUndoOnce(t)" type="button" class="routine-text-action"
                :disabled="busy" @click="undoOnce(t)">撤销</button>
            </div>
            </SwipeActions>
            <div v-if="expandedTaskMenu==='task:'+t.id" :id="'task-actions-'+t.id"
              class="routine-inline-actions" role="group" :aria-label="'操作：'+t.title"
              @keydown.esc.stop="expandedTaskMenu=null">
              <button v-if="planScope==='active'&&t.dueOn" type="button"
                @click="expandedTaskMenu=null;toggleReminderEditor('task',t.id)">提醒设置</button>
              <button v-if="canEdit(t)&&t.visibility==='household'&&t.assigneeUserId&&t.assigneeUserId!==props.userId&&!t.completedAt" type="button"
                :disabled="!!pushBusyId" @click="openTaskPush('task',t)">{{ pushBusyId===t.id?'发送中…':'通知处理人' }}</button>
            </div>
            <EditBottomSheet v-if="pushTarget==='task:'+t.id" title="通知处理人" :close-disabled="!!pushBusyId" @close="closeTaskPush">
<form class="task-push-form" @submit.prevent="notifyHandler('task',t)">
              <label>给 {{ [t.assigneeUserId,t.secondAssigneeUserId].filter(Boolean).map(memberName).join('、')||'未指派' }} 留言（可选）
                <textarea v-model.trim="pushMessage" maxlength="120" rows="2" placeholder="例如：下班顺路买一下，记得买原来的牌子"/>
              </label>
              <p v-if="pushError" role="alert" class="task-push-error">{{ pushError }}</p>
                <div class="task-push-actions">
                <button type="button" :disabled="!!pushBusyId" @click="closeTaskPush">取消</button>
                <button type="button" :disabled="!!pushBusyId" :aria-busy="!!pushBusyId"
                   @click.stop="notifyHandler('task',t)">{{ pushBusyId===t.id?'发送中…':'发送任务通知' }}</button>
              </div>
            </form>
</EditBottomSheet>
            <ReminderItemEditor v-if="reminderTarget?.kind==='task'&&reminderTarget.id===t.id"
              kind="task" :item-id="t.id" @close="reminderTarget=null"/>
            <EditBottomSheet v-if="onceEditing?.id===t.id" title="编辑任务" :close-disabled="busy" @close="onceEditing=null">
            <form class="detail-editor once-task-editor"
              @submit.prevent="saveOnce" aria-label="编辑一次性任务">
              <label class="once-edit-field">
                <span>任务名称</span>
                <input v-model="onceTitle" maxlength="150" required aria-label="任务名称" />
              </label>
              <label class="once-edit-field">
                <span>截止日期</span>
                <DateField v-model="onceDate" />
              </label>
              <label class="once-edit-remind">
                <input v-model="onceRemind" type="checkbox" />
                <span>开启提醒</span>
              </label>
              <label class="once-edit-field">
                <span>处理人</span>
                <select v-model="onceAssignee" aria-label="修改任务处理人"
                  @change="onceAssignee&&onceAssignee!==props.userId?onceVisibility='household':null;onceSecondAssignee===onceAssignee?onceSecondAssignee='':null;onceSecondAssignee||onceAssignee===props.userId?onceBonus=0:null">
                  <option value="">未指派</option>
                  <option v-for="member in (props.members||[])" :key="member.id" :value="member.id"
                    :disabled="onceVisibility==='private'&&member.id!==props.userId">
                    {{ memberName(member.id) }}
                  </option>
                </select>
              </label>
              <label v-if="onceAssignee&&onceVisibility==='household'" class="once-edit-field">
                <span>共同处理人（可选）</span>
                <select v-model="onceSecondAssignee" aria-label="修改第二位处理人" @change="onceSecondAssignee?onceBonus=0:null">
                  <option value="">仅一人负责</option>
                  <option v-for="member in (props.members||[])" :key="member.id" :value="member.id"
                    :disabled="member.id===onceAssignee">{{ memberName(member.id) }}</option>
                </select>
              </label>
              <label v-if="onceAssignee&&!onceSecondAssignee&&onceAssignee!==props.userId&&onceVisibility==='household'" class="once-edit-field">
                <span>额外奖励（由发布人积分预留）</span>
                <input v-model.number="onceBonus" type="number" inputmode="numeric" min="1" max="10000" step="1" required aria-label="额外奖励积分"/>
              </label>
              <label class="once-edit-field">
                <span>可见范围</span>
                <select v-model="onceVisibility" aria-label="任务可见范围"
                  @change="onceVisibility==='private'?(onceAssignee=props.userId,onceSecondAssignee=''):null">
                  <option value="household">家庭共享</option>
                  <option value="private">仅自己</option>
                </select>
              </label>
              <div class="detail-actions once-edit-actions">
                <button type="button" @click="onceEditing=null">取消</button>
                <button type="submit">保存修改</button>
              </div>
            </form>
            </EditBottomSheet>
            <button v-if="isFocused(t)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
          </div>
          </template>
          </template>
          <p v-if="!routines.length&&!oneTimePlans.length&&(planType!=='unscheduled'||!visibleShopping.length)" class="life-empty">{{ planType==='unscheduled'?'没有待安排事项':planScope==='active'?'还没有任务计划':'暂无历史任务计划' }}</p>
          <nav v-if="taskPage>0||canNextTaskPage" class="task-list-pager" aria-label="任务列表分页">
            <button type="button" :disabled="taskPage===0||pageBusy.routines||pageBusy.tasks"
              @click="taskPage--">上一页</button>
            <span>第 {{ taskPage+1 }} 页 · 每页 5 条</span>
            <button type="button" :disabled="!canNextTaskPage||pageBusy.routines||pageBusy.tasks"
              @click="nextTaskPage">下一页</button>
          </nav>

        </section>
        <section v-if="(planType==='all'||planType==='wish')&&(planScope!=='history'||planOutcome!=='skipped')" class="life-card">
          <h2 class="life-heading"><AppIcon name="heart" :size="21" /> 心愿计划</h2>
          <template v-for="w in items" :key="w.id">
            <div :id="'plan-item-'+w.id" :class="{'focused-plan-entry':isFocused(w)}">
            <SwipeActions :id="w.id" scope="wishes" :allow-edit="canEdit(w)" :allow-delete="canEdit(w)"
              @open="expandedTaskMenu=null" @edit="edit('wishes',w)" @delete="removeItem('wishes',w)">
              <div class="life-row" :class="{'detail-completed':w.status==='completed'||w.status==='cancelled'}">
                <div class="life-details"><b class="detail-name">{{ w.title }}</b><small>{{ wishTypeLabel(w.wish_type) }} · <StatusBadge :code="w.status" /><template v-if="w.target_on"> · {{ w.target_on }}</template></small>
                  <small v-if="linkedGoal(w)"><StatusBadge code="linked" /> 储值计划：{{ linkedGoal(w)?.title }}</small></div>
                <div class="wish-row-actions">
                  <button v-if="w.wish_type==='trip'&&w.status!=='completed'"
                    type="button" class="life-link" @click="convertWish(w)">计划</button>
                  <button v-if="(canEdit(w)&&w.status!=='cancelled')||!!linkedGoal(w)"
                    type="button" class="routine-more-trigger"
                    :aria-label="'更多操作：'+w.title"
                    :aria-expanded="expandedTaskMenu==='wish:'+w.id"
                    :aria-controls="'wish-actions-'+w.id"
                    @click.stop="toggleTaskMenu('wish:'+w.id)">
                    <AppIcon name="ellipsis" :size="19"/>
                  </button>
                </div>
              </div>
            </SwipeActions>
            <div v-if="expandedTaskMenu==='wish:'+w.id"
              :id="'wish-actions-'+w.id"
              class="routine-inline-actions plan-action-strip" role="group" :aria-label="'操作：'+w.title"
              @keydown.esc.stop="expandedTaskMenu=null">
              <button v-if="canEdit(w)&&w.status!=='cancelled'&&(!linkedGoal(w)||isOwner)"
                type="button" class="life-link" :disabled="busy" @click="finishWish(w)">
                {{ w.status==='completed'?'撤销心愿完成':'确认心愿已实现' }}</button>
              <button v-if="linkedGoal(w)" type="button" class="life-link"
                @click="emit('openPlans','goal',linkedGoal(w)?.id)">查看关联储值</button>
              <button v-if="canEdit(w)&&w.status==='completed'" type="button"
                class="life-link" :disabled="busy" @click="expandedTaskMenu=null;startPlanMemory('wish',w)">记录心愿回忆</button>
              <small v-if="linkedGoal(w)">储值达标后可完成心愿</small>
            </div>
            <EditBottomSheet v-if="planMemoryDraft?.kind==='wish'&&planMemoryDraft.id===w.id" title="记录心愿回忆" :close-disabled="busy" @close="planMemoryDraft=null">
<form
              class="life-form plan-memory-form" @submit.prevent="savePlanMemory">
              <input v-model.trim="planMemoryDraft.title" maxlength="150" required placeholder="回忆标题"/>
              <DateField v-model="planMemoryDraft.happenedOn" required/>
              <textarea v-model="planMemoryDraft.story" maxlength="8000" rows="2" placeholder="记下心愿实现的故事（选填）"></textarea>
              <label>可见范围
                <select v-model="planMemoryDraft.visibility" aria-label="计划回忆可见范围">
                  <option value="household" :disabled="planMemoryDraft.sourceVisibility==='private'">家庭共享</option>
                  <option value="private">仅自己</option>
                </select>
              </label>
              <div class="plan-memory-actions">
                <button type="button" :disabled="busy" @click="planMemoryDraft=null">取消</button>
                <button :disabled="busy||!planMemoryDraft.title.trim()">保存回忆</button>
              </div>
            </form>
</EditBottomSheet>
            <LifeItemEditor v-if="editing?.kind==='wishes'&&editing.item.id===w.id"
              kind="wishes" :item="w" @saved="changed" @cancel="editing=null"/>
            <button v-if="isFocused(w)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
            </div>
          </template>
          <p v-if="!items.length" class="life-empty">{{ planScope==='active'?'暂无进行中的心愿':'暂无已完成的心愿' }}</p>
          <button v-if="listCursors.wishes" class="life-more" type="button" :disabled="pageBusy.wishes"
            @click="loadMore('wishes')">加载更多心愿</button>

        </section>
        <section v-if="(planType==='all'||planType==='goal')&&(planScope!=='history'||planOutcome!=='skipped')" class="life-card">
          <h2 class="life-heading"><AppIcon name="wallet" :size="21" /> {{ planScope==='history'?'储值计划 · 结算历史':'储值计划' }}</h2>
          <template v-if="planScope==='history'">
            <div v-for="period in historicalGoalPeriods" :key="period.goalId+':'+period.periodKey"
              class="historical-goal-entry">
              <div class="life-row">
                <div class="life-details">
                  <b class="detail-name">{{ period.title }} · {{ period.periodKey }}{{ period.goalMode==='monthly'?'月':'年' }}</b>
                  <small>截止：{{ period.periodEnd }} · 目标 ¥{{ Number(period.targetAmount).toLocaleString('ja-JP') }}</small>
                  <small v-if="period.actualAmount!==null">
                    实际估算 ¥{{ Number(period.actualAmount).toLocaleString('ja-JP') }} ·
                    <StatusBadge :code="period.status==='pending'?'verification_pending':period.status" /> ·
                    {{ Number(period.differenceAmount)>0?'不足 ¥'+Number(period.differenceAmount).toLocaleString('ja-JP'):
                       Number(period.differenceAmount)<0?'超额 ¥'+Math.abs(Number(period.differenceAmount)).toLocaleString('ja-JP'):'差额 ¥0' }}
                  </small>
                  <small v-else><StatusBadge :code="period.status==='pending'?'verification_pending':period.status" /> · 金额未记录</small>
                </div>
                <button type="button" class="life-link"
                  :disabled="historicalGoalDetailLoading===period.goalId+'|'+period.periodKey"
                  @click="toggleHistoricalGoalPeriod(period)">
                  {{ historicalGoalDetailLoading===period.goalId+'|'+period.periodKey?'读取中…':
                    historicalGoalDetail?.goal.id===period.goalId&&historicalGoalDetail?.periodKey===period.periodKey?
                    '收起本期':'查看本期' }}
                </button>
              </div>
              <EditBottomSheet v-if="historicalGoalDetail?.goal.id===period.goalId&&historicalGoalDetail?.periodKey===period.periodKey" title="储值计划 · 本期结算详情" @close="historicalGoalDetail=null">
<FinancePanel
                :key="'historical-goal-'+period.goalId+'-'+period.periodKey"
                :trips="trips" :goals="[historicalGoalDetail.goal]" :owner="isOwner" :can-adjust="canEdit(historicalGoalDetail.goal)"
                embedded-kind="goal" :embedded-id="period.goalId"
                :initial-period-key="period.periodKey" :fixed-period-key="period.periodKey"
                @completed="goalFinished"/>
</EditBottomSheet>
            </div>
            <button v-if="historicalGoalCursor" type="button" class="life-more"
              :disabled="historicalGoalBusy" @click="loadMoreGoalPeriods">加载更多</button>
          </template>
          <template v-for="g in goals" :key="g.id">
            <div :id="'plan-item-'+g.id" :class="{'focused-plan-entry':isFocused(g)}">
            <SwipeActions :id="g.id" scope="goals" :allow-edit="canEdit(g)" :allow-delete="canEdit(g)"
              @edit="edit('goals',g)" @delete="removeItem('goals',g)">
              <div class="life-row goal-plan-row">
                <div class="life-details">
                  <div class="goal-title-row">
                    <b class="detail-name">{{ g.title }}</b>
                    <StatusBadge :code="g.start_on&&g.start_on>today()?'not_started':'active'" />
                  </div>
                  <small class="goal-amount-line">
                    <span v-if="(g.goal_mode||'once')==='once'">累计目标 ¥{{ Number(g.target_amount).toLocaleString() }} · 期初 ¥{{ Number(g.reserved_amount).toLocaleString() }}</span>
                    <span v-else>{{ g.goal_mode==='monthly'?'每月':'每年' }}目标 ¥{{ Number(g.target_amount).toLocaleString() }}</span>
                    <button v-if="g.wish_id" type="button" class="goal-wish-link"
                      :aria-label="'查看“'+g.title+'”关联的心愿计划'"
                      @click="emit('openPlans','wish',String(g.wish_id))">
                      <AppIcon name="heart" :size="13" />已关联心愿
                    </button>
                  </small>
                  <div class="goal-row-footer">
                    <small v-if="g.start_on" class="goal-dates">开始：{{ g.start_on }}<template v-if="g.target_on"> · 结束：{{ g.target_on }}</template></small>
                    <button type="button" class="goal-finance-action"
                      :aria-label="'查看“'+g.title+'”的账目与调整额'"
                      @click="toggleFinance('goal',g.id)">
                      账目与调整额 <AppIcon name="chevron-down" :size="16" class="goal-finance-chevron"/>
                    </button>
                  </div>
                </div>
              </div>
            </SwipeActions>
            <LifeItemEditor v-if="editing?.kind==='goals'&&editing.item.id===g.id"
              kind="goals" :item="g" @saved="changed" @cancel="editing=null"/>
            <EditBottomSheet v-if="financeDetail?.kind==='goal'&&financeDetail.id===g.id" title="储值计划 · 账目与调整额" @close="financeDetail=null">
<FinancePanel
              :key="'goal-finance-'+g.id" :trips="trips" :goals="goals" :owner="isOwner" :can-adjust="canEdit(g)"
              embedded-kind="goal" :embedded-id="g.id"
              :initial-period-key="isFocused(g)?props.focusPlanPeriodKey||'':''"
              :initial-completed-periods="isFocused(g)?goalCompletionMarks:[]"
              @completed="goalFinished"/>
</EditBottomSheet>
            <button v-if="isFocused(g)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
            </div>
          </template>
          <p v-if="!goals.length&&!historicalGoalPeriods.length" class="life-empty">{{ planScope==='active'?'暂无进行中的储值计划':'暂无已截止的储值记录' }}</p>
          <button v-if="listCursors.goals" class="life-more" type="button" :disabled="pageBusy.goals"
            @click="loadMore('goals')">加载更多目标</button>

        </section>
        <section v-if="(planType==='all'||planType==='shopping'||(planType==='unscheduled'&&visibleShopping.length>0))&&
          (planScope!=='history'||!['skipped','missed'].includes(planOutcome))" class="life-card shopping-plans-card">
          <h2 class="life-heading"><AppIcon name="shopping" :size="21" /> 购物计划</h2>
          <template v-for="s in visibleShopping" :key="s.id">
            <div :id="'plan-item-'+s.id" class="shopping-plan-entry" :class="{'focused-plan-entry':isFocused(s)}">
            <SwipeActions :id="s.id" scope="shopping" :allow-edit="canEdit(s)" :allow-delete="canEdit(s)"
              @open="expandedTaskMenu=null" @edit="edit('shopping',s)" @delete="removeItem('shopping',s)">
              <div class="life-row shopping-line" :class="{'detail-completed':!!s.completed_at}">
                <div class="shopping-check">
                  <div class="shopping-plan-content">
                    <div class="shopping-title-row">
                      <b class="detail-name">{{ s.title }} <small v-if="s.quantity>1">× {{ s.quantity }}</small></b>
                      <div class="shopping-heading-end">
                        <button v-if="isOwner&&(canEdit(s)||s.visibility==='household')" type="button"
                          class="shopping-ledger-icon" :class="{'is-linked':!!s.ledger_entry_id}"
                          :aria-label="(s.ledger_entry_id?'查看关联账单：':'关联账单：')+s.title"
                          :title="s.ledger_entry_id?'查看关联账单':'关联账单'"
                          @click.stop="toggleLedger(s.id)">
                          <AppIcon name="link" :size="17"/>
                        </button>
                        <StatusBadge :code="s.completed_at?'completed':'to_buy'" />
                      </div>
                    </div>
                    <div class="shopping-meta-row">
                      <small class="shopping-plan-date">{{ s.due_on?'计划日期：'+s.due_on:'待安排' }}</small>
                      <button v-if="planScope==='active'&&!s.completed_at&&(!!s.due_on||
                        (canEdit(s)&&s.visibility==='household'&&s.assigned_to&&
                           [s.assigned_to,s.second_assignee_user_id].some(id=>id!==props.userId)))"
                        type="button" class="routine-more-trigger shopping-more-trigger"
                        :aria-label="'更多操作：'+s.title"
                        :aria-expanded="expandedTaskMenu==='shopping:'+s.id"
                        :aria-controls="'shopping-actions-'+s.id"
                        @click.stop="toggleTaskMenu('shopping:'+s.id)">
                        <AppIcon name="ellipsis" :size="19"/>
                      </button>
                    </div>
                    <div class="shopping-handler-row">
                      <small class="shopping-assignees" :title="'处理人：'+([s.assigned_to,s.second_assignee_user_id].filter(Boolean).map(memberName).join('、')||'未指派')">处理人：{{ [s.assigned_to,s.second_assignee_user_id].filter(Boolean).map(memberName).join('、')||'未指派' }}</small>
                      <div v-if="!s.completed_at&&s.ledger_entry_id&&shoppingCompletable(s)" class="shopping-row-actions">
                        <button type="button" class="life-link" :disabled="busy"
                          @click="confirmShopping(s)">确认完成</button>
                      </div>
                    </div>
                    <small v-if="s.ledger_entry_id&&!s.completed_at">已验证账单 · 待指定人确认</small>
                  </div>
                </div>
              </div>
            </SwipeActions>
            <div v-if="expandedTaskMenu==='shopping:'+s.id" :id="'shopping-actions-'+s.id"
              class="routine-inline-actions shopping-inline-actions" role="group" :aria-label="'操作：'+s.title"
              @keydown.esc.stop="expandedTaskMenu=null">
              <button v-if="planScope==='active'&&s.due_on" type="button"
                @click="expandedTaskMenu=null;toggleReminderEditor('shopping',s.id)">提醒设置</button>
              <button v-if="canEdit(s)&&s.visibility==='household'&&s.assigned_to&&
                  [s.assigned_to,s.second_assignee_user_id].some(id=>id&&id!==props.userId)&&!s.completed_at"
                type="button" :disabled="!!pushBusyId" @click="openTaskPush('shopping',s)">通知处理人</button>
            </div>
            <EditBottomSheet v-if="pushTarget==='shopping:'+s.id" title="通知处理人" :close-disabled="!!pushBusyId" @close="closeTaskPush">
<form class="task-push-form"
              @submit.prevent="notifyHandler('shopping',s)">
              <label>给 {{ [s.assigned_to,s.second_assignee_user_id].filter(Boolean).map(memberName).join('、') }} 留言（可选）
                <textarea v-model.trim="pushMessage" maxlength="120" rows="2"
                  placeholder="例如：下班顺路买一下哦"/>
              </label>
              <p v-if="pushError" role="alert" class="task-push-error">{{ pushError }}</p>
                <div class="task-push-actions">
                <button type="button" :disabled="!!pushBusyId" @click="closeTaskPush">取消</button>
                <button type="button" :disabled="!!pushBusyId" :aria-busy="!!pushBusyId"
                   @click.stop="notifyHandler('shopping',s)">{{ pushBusyId===s.id?'发送中…':'发送购物通知' }}</button>
              </div>
            </form>
</EditBottomSheet>
            <ReminderItemEditor v-if="reminderTarget?.kind==='shopping'&&reminderTarget.id===s.id"
              kind="shopping" :item-id="s.id" @close="reminderTarget=null"/>
            <LifeItemEditor v-if="editing?.kind==='shopping'&&editing.item.id===s.id"
              kind="shopping" :item="s" :members="props.members" :profiles="props.profiles"
              :user-id="props.userId" @saved="changed" @cancel="editing=null"/>
            <ShoppingLedgerPicker v-if="ledgerPickerId===s.id" :shopping-id="s.id" :linked-id="s.ledger_entry_id"
              @saved="shoppingLinksChanged" @close="ledgerPickerId=null"/>
            <button v-if="isFocused(s)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
            </div>
          </template>
          <p v-if="!visibleShopping.length&&planType!=='unscheduled'" class="life-empty">{{ planScope==='active'?'没有待购买的东西':'没有已完成的购物记录' }}</p>
          <button v-if="listCursors.shopping" class="life-more" type="button" :disabled="pageBusy.shopping"
            @click="loadMore('shopping')">加载更多购物记录</button>


        </section>
        <section v-if="(planType==='all'||planType==='trip')&&(planScope!=='history'||planOutcome!=='skipped')" class="life-card">
          <div class="trip-section-header">
            <h2 class="life-heading"><AppIcon name="plane" :size="21" /> 旅行计划</h2>
            <button type="button" class="trip-import-trigger" @click="tripImportOpen=true">导入行程</button>
          </div>
          <template v-for="t in trips" :key="t.id">
            <div :id="'plan-item-'+t.id" :class="{'focused-plan-entry':isFocused(t)}">
            <SwipeActions :id="t.id" scope="trips" :allow-edit="canEdit(t)" :allow-delete="canEdit(t)"
              @open="expandedTaskMenu=null" @edit="edit('trips',t)" @delete="removeItem('trips',t)">
              <div class="life-row trip-plan-row" :class="{'detail-completed':t.status==='completed'||t.status==='cancelled'}">
                <div class="life-details">
                  <div class="trip-title-row">
                    <b class="detail-name">{{ t.title }}</b>
                    <StatusBadge :code="t.status" />
                  </div>
                  <small class="trip-summary-line">{{ t.destination }} · {{ t.startOn||'日期待确定' }}</small>
                </div>
                <div class="trip-participant-actions">
                  <span class="trip-participant-names" :title="'参与 '+tripParticipantNames(t)">参与 {{ tripParticipantNames(t) }}</span>
                  <div class="trip-card-actions">
                    <button type="button" class="life-link" @click.stop="selectTrip(t.id)">行程</button>
                    <button v-if="isOwner||t.visibility==='household'" type="button" class="life-link trip-finance-trigger"
                      @click.stop="toggleFinance('trip',t.id)">费用</button>
                    <button v-if="canEdit(t)&&t.status==='completed'"
                      type="button" class="routine-more-trigger"
                      :aria-label="'更多操作：'+t.title"
                      :aria-expanded="expandedTaskMenu==='trip:'+t.id"
                      :aria-controls="'trip-actions-'+t.id"
                      @click.stop="toggleTaskMenu('trip:'+t.id)">
                      <AppIcon name="ellipsis" :size="19"/>
                    </button>
                  </div>
                </div>
              </div>
            </SwipeActions>
            <div v-if="expandedTaskMenu==='trip:'+t.id&&canEdit(t)&&t.status==='completed'"
              :id="'trip-actions-'+t.id"
              class="trip-inline-actions" role="group" :aria-label="'操作：'+t.title"
              @keydown.esc.stop="expandedTaskMenu=null">
              <button type="button" class="life-link" :disabled="busy"
                @click="expandedTaskMenu=null;startPlanMemory('trip',t)">记录旅行回忆</button>
            </div>
            <EditBottomSheet v-if="planMemoryDraft?.kind==='trip'&&planMemoryDraft.id===t.id" title="记录旅行回忆" :close-disabled="busy" @close="planMemoryDraft=null">
<form
              class="life-form plan-memory-form" @submit.prevent="savePlanMemory">
              <input v-model.trim="planMemoryDraft.title" maxlength="150" required placeholder="回忆标题"/>
              <DateField v-model="planMemoryDraft.happenedOn" required/>
              <textarea v-model="planMemoryDraft.story" maxlength="8000" rows="2" placeholder="旅行故事和感想（选填）"></textarea>
              <label>可见范围
                <select v-model="planMemoryDraft.visibility" aria-label="计划回忆可见范围">
                  <option value="household" :disabled="planMemoryDraft.sourceVisibility==='private'">家庭共享</option>
                  <option value="private">仅自己</option>
                </select>
              </label>
              <div class="plan-memory-actions">
                <button type="button" :disabled="busy" @click="planMemoryDraft=null">取消</button>
                <button :disabled="busy||!planMemoryDraft.title.trim()">保存回忆</button>
              </div>
            </form>
</EditBottomSheet>
            <LifeItemEditor v-if="editing?.kind==='trips'&&editing.item.id===t.id"
              kind="trips" :item="t" :profiles="props.profiles" :members="props.members" :user-id="props.userId" @saved="changed" @cancel="editing=null"/>
            <EditBottomSheet v-if="(isOwner||t.visibility==='household')&&financeDetail?.kind==='trip'&&financeDetail.id===t.id" title="旅行 · 费用与调整额" @close="financeDetail=null">
<FinancePanel
              :key="'trip-finance-'+t.id" :trips="trips" :goals="goals" :owner="isOwner"
              embedded-kind="trip" :embedded-id="t.id"/>
</EditBottomSheet>
            <button v-if="isFocused(t)&&props.focusPlanFromToday" type="button" class="life-return" @click="emit('backToToday')">返回今天</button>
            </div>
          </template>
          <p v-if="!trips.length" class="life-empty">{{ planScope==='active'?'暂无进行中的旅行':'暂无已结束的旅行' }}</p>
          <button v-if="listCursors.trips" class="life-more" type="button" :disabled="pageBusy.trips"
            @click="loadMore('trips')">加载更多旅行</button>
          <div v-if="tripDetail" class="trip-detail">
            <div class="trip-detail-header">
              <h3>{{ tripDetail.title }}</h3>
              <button type="button" class="trip-detail-close" @click="tripDetail=null" aria-label="收起行程">×</button>
            </div>
            <div class="trip-participant-summary">
              <span>参与人：{{ tripParticipantNames(tripDetail) }}</span>
              <span v-if="tripRewardPerPerson(tripDetail)">每人 {{ tripDetail.status==='completed'?'已获得':'结束后可获得' }} {{ tripRewardPerPerson(tripDetail) }} 分</span>
            </div>
            <div class="trip-progress">
              <span>行程清单 {{ tripItineraryCompleted }} / {{ tripItineraryItems.length }}</span>
              <span>{{ tripItineraryItems.length?Math.round(tripItineraryCompleted/tripItineraryItems.length*100):0 }}%</span>
              <div class="trip-progress-track" role="progressbar" :aria-valuenow="tripItineraryCompleted"
                aria-valuemin="0" :aria-valuemax="tripItineraryItems.length" aria-label="行程清单勾选进度">
                <div class="trip-progress-fill" :style="{width:(tripItineraryItems.length?tripItineraryCompleted/tripItineraryItems.length*100:0)+'%'}"></div>
              </div>
            </div>
            <template v-if="tripDetail.plan">
              <div v-for="d in tripDetail.plan.trip.days" :key="d.date" class="trip-day"><b>{{ d.date }}</b>
                <SwipeActions v-for="it in d.items" :key="it.externalId" :id="it.externalId" :scope="'trip-'+tripDetail.id"
                    :allow-edit="tripDetail.createdBy===props.userId"
                    :allow-delete="tripDetail.createdBy===props.userId"
                    @edit="editTripItem(it)" @delete="removeTripItem(it)">
                  <div class="trip-detail-row">
                  <label class="trip-item" :class="{done:itemDone(it.externalId)}">
                    <input type="checkbox" :checked="itemDone(it.externalId)" @change="toggleTrip(it.externalId)"/>
                    <span class="trip-item-text"><strong>{{ it.startTime||'待定' }}</strong> · {{ tripDisplayTitle(it) }}</span>
                    <StatusBadge :code="itemDone(it.externalId)?'completed':'pending'" />
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
                    <StatusBadge :code="itemDone(task.externalId)?'completed':'pending'" />
                  </label>
                  <button v-if="task.dueDate&&(tripDetail.createdBy===props.userId||task.visibility==='household')"
                    type="button" class="life-link" @click.stop="toggleReminderEditor('trip',tripDetail.id+':'+task.externalId)">提醒设置</button>
                </div>
                <ReminderItemEditor v-if="reminderTarget?.kind==='trip'&&reminderTarget.id===tripDetail.id+':'+task.externalId"
                  kind="trip" :item-id="tripDetail.id+':'+task.externalId" @close="reminderTarget=null"/>
                </SwipeActions>
              </div>
              <div v-for="list in tripDetail.plan.trip.packingLists||[]" :key="list.externalId" class="trip-day">
                <b class="life-heading"><AppIcon name="shopping" :size="18" /> 行李清单</b>
                <SwipeActions v-for="piece in list.items" :key="piece.externalId" :id="piece.externalId" :scope="'trip-'+tripDetail.id"
                    :allow-edit="tripDetail.createdBy===props.userId"
                    :allow-delete="tripDetail.createdBy===props.userId"
                    @edit="editTripItem(piece)" @delete="removeTripItem(piece)">
                  <div class="trip-detail-row">
                  <label class="trip-item" :class="{done:itemDone(piece.externalId)}">
                    <input type="checkbox" :checked="itemDone(piece.externalId)" @change="toggleTrip(piece.externalId)"/>
                    <span>{{ piece.label }} × {{ piece.quantity }}</span>
                    <StatusBadge :code="itemDone(piece.externalId)?'completed':'pending'" />
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
                  <span>{{ booking.title }} · <StatusBadge :code="booking.status||'pending'" /></span>
                </div>
                </SwipeActions>
              </div>
            </template>
            <p v-else class="life-caption">暂无行程</p>
            <button v-if="!['completed','cancelled'].includes(tripDetail.status)&&tripDetail.createdBy===props.userId"
              type="button" class="trip-finish-action" :disabled="busy" @click="completeTrip">
              <AppIcon name="check" :size="17"/> 完成整趟旅行
            </button>
          </div>
           <EditBottomSheet v-if="tripImportOpen" title="导入行程 JSON" :close-disabled="busy" @close="tripImportOpen=false">
           <div class="trip-import">
            <label>导入到哪个旅行项目？
              <select v-model="importTargetId" aria-label="选择导入旅行项目"><option value="">新建旅行项目</option><option v-for="t in trips" :key="t.id" :value="t.id">{{ t.title }}</option></select>
            </label>
            <textarea v-model="paste" rows="4" placeholder="粘贴完整的 JSON 内容" aria-label="行程 JSON 内容"></textarea>
            <button class="life-light" @click="previewTrip">验证与预览</button>
            <div v-if="preview" class="trip-preview">
              <b><StatusBadge :code="preview.changes==='new'?'new':preview.changes==='unchanged'?'unchanged':'updated'" :label="preview.changes==='new'?'新旅行':preview.changes==='unchanged'?'未发生变化':'更新已有旅行'" /></b>
              <p>{{ preview.summary.days }} 天 / {{ preview.summary.itineraryItems }} 项行程 / {{ preview.summary.tasks }} 项准备任务</p>
              <button :disabled="busy" @click="importTrip">确认导入</button>
            </div>
          <p v-if="error" class="life-error" role="alert">{{ error }}</p></div>
           </EditBottomSheet>
        </section>
      </div>
      <section class="life-card plan-recap">
       <div class="life-heading"><AppIcon name="clipboard-check" :size="18" /> 月度回顾
         <button type="button" class="life-filter-trigger" @click="recapFormOpen=true">选择月份</button>
       </div>
       <EditBottomSheet v-if="recapFormOpen" title="生成月度回顾" :close-disabled="recapBusy" @close="recapFormOpen=false">
         <div class="plan-recap-controls">
          <label>年份<select v-model="recapYear" aria-label="回顾年份">
            <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
          </select></label>
          <label>月份<select v-model="recapMonth" aria-label="回顾月份">
            <option v-for="m in monthOptions" :key="m" :value="m">{{ Number(m) }} 月</option>
          </select></label>
          <button type="button" :disabled="recapBusy" @click="loadRecap">{{ recapBusy?'统计中…':'生成回顾' }}</button>
        </div>
         <p v-if="recapError" role="alert" class="life-error">{{ recapError }}</p>
       </EditBottomSheet>
       
        <p v-if="recapError" role="alert" class="life-error">{{ recapError }}</p>
        <div v-if="recap" class="plan-recap-results">
          <strong>{{ recap.month }} · 已完成／核验 {{ recap.total }} 次</strong>
          <div v-for="(label,key) in recapLabels" :key="key" class="plan-recap-line">
            <span>{{ label }}</span><b>{{ recap.counts[key]||0 }} 次</b>
          </div>
          
        </div>
      
      </section>
     </template>

    <template v-else-if="mode==='memories'">
      <section class="life-card">
        <div class="life-section-heading">
          <h2 class="life-heading"><AppIcon name="images" :size="21" /> 我们的时光轴</h2>
          <button type="button" class="section-add-button" :aria-expanded="showMemoryForm"
            aria-controls="new-memory-form" :disabled="busy"
            aria-label="添加回忆" title="添加回忆"
            @click="showMemoryForm=true"><AppIcon name="plus" :size="19" /></button>
        </div>
        <EditBottomSheet v-if="showMemoryForm" title="添加回忆" :close-disabled="busy" @close="showMemoryForm=false">
        <form id="new-memory-form" class="life-form" @submit.prevent="addMemory">
          <input v-model.trim="memoryTitle" required maxlength="150" placeholder="今天有什么值得记住？"/>
          <label>发生日期<DateField v-model="memoryDate" required /></label>
          <textarea v-model="memoryStory" maxlength="8000" rows="3" placeholder="写下一段日记……"></textarea>
          <label>可见范围
            <select v-model="memoryVisibility" aria-label="新回忆可见范围">
              <option value="household">家庭共享</option>
              <option value="private">仅自己</option>
            </select>
          </label>
          <label @click.capture="beginPhotoPicker()">照片（可选）
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              @cancel="finishPhotoPicker()"
              @change="finishPhotoPicker();photoFiles=Array.from(($event.target as HTMLInputElement).files||[]).slice(0,10)"/></label>
          <button :disabled="busy">保存到时光轴</button>
          <button type="button" class="life-cancel" :disabled="busy" @click="showMemoryForm=false">取消</button>
        </form>
        </EditBottomSheet>

        <button type="button" class="life-filter-trigger" @click="memoryFilterOpen=true">筛选日期 · {{ memoryYear||'全部' }}</button>
        <EditBottomSheet v-if="memoryFilterOpen" title="筛选时光轴" @close="memoryFilterOpen=false">
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
        <button class="life-more" type="button" @click="memoryFilterOpen=false">完成</button>
        </EditBottomSheet>

        <p v-if="listLoading" class="life-caption" role="status">正在读取时光轴…</p>
        <p v-else-if="!items.length" class="life-empty">暂无回忆</p>
        <article v-for="m in listLoading?[]:items" :key="m.id" :id="'plan-item-'+m.id"
          class="memory" :class="{'focused-plan-entry':isFocused(m)}">
          <SwipeActions :id="m.id" scope="memories" :allow-edit="canEdit(m)" :allow-delete="canEdit(m)"
            @edit="edit('memories',m)" @delete="removeItem('memories',m)">
            <div class="memory-swipe-body">
              <div class="memory-swipe-heading">
                <time>{{ m.happened_on }}</time>
                <div class="memory-heading-content">
                  <h3>{{ m.title }}</h3>
                  <label v-if="cloudEnabled&&m.created_by===props.userId" class="memory-add-photo"
                    title="添加照片" aria-label="添加照片" @click.capture="beginPhotoPicker()">
                    <AppIcon name="image-upload" :size="19" />
                    <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                      aria-label="添加照片" :disabled="busy"
                      @cancel="finishPhotoPicker()" @change="uploadAdditionalPhotos(m.id,$event)"/>
                  </label>
                </div>
              </div>
              <div v-if="cloudPhotos[m.id]?.length" class="memory-photos cloud">
                <PhotoThumbnail v-for="remote in cloudPhotos[m.id]"
                  :key="remote.id+'-'+(photoVersions[remote.id]||0)"
                  :id="remote.id" :user-id="props.userId" :title="m.title"
                  @open="url=>previewCloudPhoto(remote,m.id,m.title,url)"/>
              </div>
              <button v-if="photoCursors[m.id]" type="button" class="memory-more-photos"
                :disabled="photoPageBusy[m.id]" @click.stop="loadMorePhotos(m.id)">
                {{ photoPageBusy[m.id]?'正在加载…':'查看更多照片' }}
              </button>
              <div v-if="photos[m.id]?.length" class="memory-photos">
                <button v-for="(image,i) in photos[m.id]" :key="image"
                  type="button" class="memory-photo-button" :aria-label="'放大查看：'+m.title"
                  @click.stop="previewDevicePhoto(m.id,i,m.title,image)">
                  <img :src="image" :alt="m.title+' 照片 '+(i+1)" loading="lazy"/>
                </button>
              </div>
              <button v-if="photos[m.id]?.length&&cloudEnabled&&m.created_by===props.userId"
                type="button" class="memory-more-photos" :disabled="busy"
                @click.stop="syncLocalPhotos(m.id)">同步旧照片</button>
          <p>{{ m.story }}</p><small class="memory-visibility"><AppIcon :name="m.visibility==='private'?'shield':'house'" :size="14" /> <span class="memory-audience">{{ m.visibility==='private'?'私人回忆':'家庭共享' }}</span><span class="memory-attribution" :title="'来自：'+memberName(m.created_by)">· 来自：{{ memberName(m.created_by) }}</span></small>
            </div>
          </SwipeActions>
          <LifeItemEditor v-if="editing?.kind==='memories'&&editing.item.id===m.id"
            kind="memories" :item="m" @saved="changed" @cancel="editing=null"/>
        </article>
        <button v-if="!listLoading&&listCursors.memories" type="button" class="life-more" :disabled="pageBusy.memories"
          @click="loadMore('memories')">加载更多回忆</button>
      </section>
      <PhotoViewer v-if="openPhoto" :src="openPhoto.src" :title="openPhoto.title"
        :busy="viewerBusy"
        :can-edit="openPhoto.kind==='cloud'?openPhoto.uploadedBy===props.userId:cloudEnabled"
        :can-delete="openPhoto.kind==='cloud'?openPhoto.uploadedBy===props.userId:true"
        @close="openPhoto=null" @save="saveViewedPhoto" @delete="deleteViewedPhoto"/>
    </template>
    <EditBottomSheet v-if="convertWishEdit" title="由心愿创建旅行" :close-disabled="busy" @close="convertWishEdit=null">
     <form class="life-form" @submit.prevent="submitConvertWish">
      <label>旅行目的地<input v-model.trim="convertWishEdit.destination" required maxlength="300" placeholder="例如：北海道"/></label>
      <p v-if="error" role="alert" class="life-error">{{ error }}</p>
      <button :disabled="busy||!convertWishEdit.destination.trim()" type="submit">确认创建旅行</button>
     </form>
    </EditBottomSheet>
    <EditBottomSheet v-if="tripItemEdit" title="编辑旅行明细" :close-disabled="busy" @close="tripItemEdit=null">
     <form class="life-form" @submit.prevent="saveTripItem">
      <label>名称<input v-model.trim="tripItemEdit.title" required maxlength="150"/></label>
      <p v-if="error" role="alert" class="life-error">{{ error }}</p>
      <button :disabled="busy||!tripItemEdit.title.trim()" type="submit">保存修改</button>
     </form>
    </EditBottomSheet>
  </section>
</template>

<style scoped>
.life-filter-trigger{padding:7px 10px;background:#eef6f0;border:1px solid #c9dfcf;border-radius:9px;color:#397a59;font-size:12px;font-weight:650}
.plan-recap{margin:12px 0;padding:12px 14px}
.plan-recap summary{cursor:pointer;display:flex;align-items:center;gap:7px;font-size:14px;font-weight:650}
.plan-recap-controls{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin-top:10px}
.plan-recap-controls label{display:grid;gap:4px;font-size:12px;min-width:80px;flex:1}
.plan-recap-controls select{width:100%;min-width:0;max-width:100%;box-sizing:border-box;padding:8px;border-radius:9px}
.plan-recap-controls button{min-height:40px;white-space:nowrap}
.plan-recap-results{display:grid;gap:8px;margin-top:12px;padding:9px;border-radius:10px;background:#f5faf6}
.plan-recap-results strong{font-size:14px}.plan-recap-results small{font-size:11px;color:#708376;line-height:1.6}
.plan-recap-line{display:flex;justify-content:space-between;gap:12px;font-size:12px;border-top:1px solid #e3eee5;padding-top:6px}
.plan-memory-form{margin:8px 0 12px;padding:10px;border:1px solid #dbe8dd;border-radius:10px;background:#f5faf6}
.plan-memory-form textarea{min-width:0;max-width:100%;box-sizing:border-box;width:100%}
.plan-memory-actions{display:flex;justify-content:flex-end;gap:8px}
.life-return{border:0;border-radius:9px;
  background:#43866a;color:#fff;padding:8px 10px;font-size:12px;white-space:nowrap}
.focused-plan-entry{background:#f7fbf8;border-radius:8px;padding:2px 9px;
  box-shadow:inset 3px 0 0 #72aa88;scroll-margin-top:176px}
.plan-action-strip{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:8px 0}
.plan-action-strip small{font-size:11px;color:#668776}
.life-return{display:block;margin:10px 0 12px;background:#eaf3ec;color:#397e59}
.plan-filter-tabs{display:flex;gap:6px;overflow-x:auto;padding:0 0 11px;scrollbar-width:none}
.plan-filter-tabs button{border:1px solid #d8e6dc;background:#fff;color:#648171;border-radius:999px;
 padding:8px 12px;min-height:36px;flex:none;font-size:12px}
.plan-filter-tabs button.selected{background:#43866a;color:#fff;border-color:#43866a}
.trip-section-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.trip-section-header h2{margin:0}
.trip-import-trigger{background:#edf5ef;color:#397e5f;border:1px solid #d4e6d9;border-radius:9px;padding:8px 11px;font-size:12px;font-weight:650;min-height:36px;white-space:nowrap}
.trip-card-actions,.wish-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex:none;flex-wrap:wrap}
.trip-card-actions .life-link{min-height:34px;white-space:nowrap}
.trip-card-actions .routine-more-trigger{width:34px;height:34px}
.trip-inline-actions{display:flex;gap:6px;padding:5px 0 8px}
.trip-detail-header{display:flex;align-items:center;justify-content:space-between;gap:10px}
.trip-detail-header h3{margin:0;min-width:0;overflow-wrap:anywhere}
.trip-detail-close{display:grid;place-items:center;border:none;background:#e9f0e9;color:#567765;border-radius:9px;width:32px;height:32px;flex:none}
.trip-progress{display:grid;grid-template-columns:1fr auto;gap:6px;margin:10px 0 12px;color:#506e5b;font-size:12px}
.trip-progress-track{grid-column:1/-1;height:6px;background:#dfe9dd;border-radius:10px;overflow:hidden}
.trip-progress-fill{height:100%;border-radius:10px;background:#43866a;transition:width .2s}
.trip-finish-action{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:13px;padding:10px 12px;border:none;border-radius:10px;background:#43866a;color:#fff;font-size:13px;font-weight:700}
.trip-finish-action:disabled{opacity:.5}
.once-edit{background:#f6faf6;border-radius:12px;padding:12px}
.once-remind{display:flex!important;align-items:center;gap:9px}
.once-remind input{width:18px!important;min-height:18px!important}
.once-actions{display:flex;gap:8px}.once-actions button{flex:1}
@media(max-width:480px){.trip-card-actions,.wish-row-actions{max-width:48%;justify-content:flex-end}
 .plan-filter-tabs button{padding:7px 10px}}

.task-list-pager{display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 0 4px;font-size:12px;color:#74897a}
.task-list-pager button{border:1px solid #d3e5d8;border-radius:9px;background:#f4faf6;color:#397e5f;min-height:36px;padding:7px 13px;font-size:12px}
.task-list-pager button:disabled{opacity:.42}
/* Each task is one uninterrupted swipe surface (title, metadata and actions).
   Only the outside item owns a separator; no line is painted inside a task. */
.plan-tasks-card .life-caption{margin:0 0 8px}

/* Routine 2.0: one divider, compact rows, discreet actions. */
.routine-compact{min-width:0;display:grid;gap:5px}
.plan-task-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0;width:100%}
.plan-task-head .detail-name{font-size:14px;line-height:1.45;overflow-wrap:anywhere;min-width:0;flex:1}
.plan-task-heading-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex:none;margin-left:auto}
.plan-task-status{flex:none;white-space:nowrap}
.plan-task-head>.plan-task-status{margin-left:auto}
.routine-meta{display:block;color:#85958a;font-size:11px;line-height:1.5}
.plan-tasks-card .plan-task-item{border-bottom:1px solid #e5ece6;padding:11px 0;margin:0}
.plan-tasks-card .plan-task-item:last-of-type{border-bottom:0}
.plan-tasks-card .plan-task-footer{margin-top:3px;justify-content:space-between;flex-wrap:nowrap;gap:8px;min-height:30px}
.plan-tasks-card .plan-task-next{white-space:normal;min-width:0;flex:1}
.routine-text-action{border:0;background:transparent;color:#397f5f;font-size:12px;font-weight:650;flex:none;padding:6px 4px;min-height:32px}
.routine-text-action:disabled{opacity:.5}
.routine-more-trigger{display:grid;place-items:center;flex:none;width:36px;height:36px;
  padding:0;border:0;border-radius:9px;background:transparent;color:#829c8c;cursor:pointer}
.routine-more-trigger[aria-expanded="true"]{background:#edf5ee;color:#397e5f}
.routine-more-trigger:focus-visible{outline:2px solid #43866a;outline-offset:1px}
.routine-inline-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;
  margin:4px 0 7px;padding:10px 0 3px;border-top:1px dashed #e5ece6}
.routine-inline-actions button{border:0;border-radius:9px;background:#eff5f0;
  color:#476d57;font-size:12px;min-height:36px;padding:8px 12px;font-weight:600}
.routine-inline-actions button:disabled{opacity:.45}
.routine-state{flex:none}
.routine-struck{text-decoration:line-through;color:#9ca99f}
.routine-history-row{display:grid;gap:5px}
@media(max-width:420px){.plan-task-head .detail-name{font-size:13px}.plan-tasks-card .plan-task-next{font-size:10px}}
.plan-task-item{min-width:0;padding:12px 0;border-bottom:1px solid #e9eee9}
.plan-task-item:last-of-type{border-bottom:0;padding-bottom:0}
.plan-task-item .life-row{border:0;padding:0;min-height:0;align-items:flex-start}
.plan-task-item :deep(.swipe-row),.plan-task-item :deep(.swipe-content){
  border:0;box-shadow:none;margin:0;
}
.plan-task-item :deep(.swipe-content){background:#fff}
/* Active routine and one-time rows are one complete swipe surface, including
   their outer vertical breathing room. The colored rails follow the full height
   instead of stopping after the old hard 72px limit. */
.plan-tasks-card .plan-task-item[data-swipe-item]{padding-block:0}
.plan-task-item[data-swipe-item] :deep(.swipe-content){padding-block:5px}
.plan-task-item[data-swipe-item] :deep(.swipe-actions){align-items:stretch;background:#fff}
.plan-task-item[data-swipe-item] :deep(.swipe-actions button){
  align-self:stretch;height:auto;min-height:0;flex:0 0 72px
}
/* The opaque moving content continues to mask rails until swiped. */
.plan-task-item .routine-compact{width:100%;min-width:0;overflow-wrap:anywhere}
.plan-task-item .life-details .detail-name{display:block;font-size:14px;line-height:1.45}
.plan-task-item .life-details small{font-size:11px;line-height:1.55;margin-top:4px}
.plan-task-footer{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap;margin-top:8px}
.plan-task-next{font-size:11px;line-height:1.4;color:#7d8e83;white-space:nowrap}
.plan-task-controls{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;min-width:0}
.plan-task-subtle,.plan-task-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;
  min-height:31px;border:0;border-radius:9px;padding:6px 10px;font-size:11px;font-weight:650;white-space:nowrap}
.plan-task-subtle{background:#f1f6f2;color:#527f67}
.plan-task-action{background:#e5f1e8;color:#367a59}
.plan-task-subtle:focus-visible,.plan-task-action:focus-visible{outline:2px solid #43866a;outline-offset:2px}
.plan-task-action:disabled{opacity:.55}
@media(max-width:370px){.plan-task-next{flex-basis:100%}}
.life-area{margin:23px 0 5px}.life-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start}.life-card{background:#fff;border:1px solid #eeebe5;border-radius:18px;padding:20px;margin:0 0 16px;box-shadow:0 4px 16px #28332807}.life-card h2{font-size:17px;margin:0 0 11px}.life-card h3{font-size:15px}.life-caption{font-size:11px;line-height:1.7;color:#82948b}.life-empty{font-size:12px;color:#9ba69d;text-align:center;padding:14px 0}.life-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 0;border-bottom:1px solid #f0eee9;font-size:13px}.life-row label{display:flex;align-items:center;gap:8px}.life-row small{display:block;color:#87968b;margin-top:4px}.life-form{display:grid;gap:9px;margin-top:14px}.life-form input,.life-form select,.life-form textarea,.trip-import textarea{width:100%;padding:9px 11px;min-height:40px;border-radius:10px;border:1px solid #e0e7df;background:#fff;color:#283b30;font-size:13px}.life-form label{font-size:12px;color:#738477;display:grid;gap:5px}.life-form button,.trip-preview button{background:#478969;border:none;border-radius:10px;color:white;padding:10px 12px;font-weight:700}.life-link{color:#4a896b;background:#edf5ed;border:0;border-radius:9px;padding:8px;white-space:nowrap;font-size:12px}.life-error{background:#fff0eb;color:#a14d36;padding:12px;border-radius:10px;font-size:12px}.life-notice{background:#e5f2e8;color:#317355;padding:10px;border-radius:10px;font-size:12px}.trip-detail,.trip-import{padding:14px;background:#f6f8f2;border-radius:12px;margin-top:12px}.trip-import summary{cursor:pointer;font-size:13px;font-weight:700}.trip-import textarea{margin:10px 0}.trip-item{display:flex;align-items:flex-start;gap:9px;font-size:12px;margin:0;min-width:0}.trip-item input[type="checkbox"]{flex:0 0 19px;width:19px;height:19px;margin:1px 0 0;accent-color:#43866a}.trip-item-text{min-width:0;line-height:1.5;overflow-wrap:anywhere}.trip-item-text strong{white-space:nowrap;color:#4f715b;font-size:12px}.trip-day{border-top:1px solid #e8ece6;padding:11px 0}.trip-day>.life-heading{margin-bottom:10px!important;display:flex;align-items:center;gap:7px}.trip-day :deep(.swipe-content){padding:0;background:transparent}.trip-day .trip-detail-row{padding:7px 0}
.trip-detail-row{display:flex;align-items:flex-start;justify-content:space-between;gap:7px;min-width:0;flex-wrap:nowrap}
.trip-detail-row .trip-item{min-width:0;flex:1;overflow-wrap:anywhere;align-items:flex-start}.trip-detail-row .trip-item :deep(.status-badge){flex:none;margin-left:auto}
.trip-item.done span{color:#9aa99d;text-decoration:line-through}
.trip-item-actions{display:flex;gap:5px;flex:none}
.trip-item-actions button{border:0;border-radius:7px;background:#edf5ed;color:#43866a;padding:6px 8px;font-size:11px}
.trip-item-actions .remove{background:#faefeb;color:#ab5d4a}.life-light{padding:10px;border-radius:9px;background:white;color:#478969;border:1px solid #a2c5ad}.trip-preview{padding:12px 0;font-size:12px}.memory{border-left:2px solid #c1d8c7;margin:15px 0;padding:1px 14px}.memory time,.memory small{font-size:11px;color:#8a9d90}.memory h3{margin:8px 0}.memory p{font-size:13px;white-space:pre-wrap;line-height:1.7}.memory-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.memory-swipe-body{min-width:0;width:100%;overflow-wrap:anywhere;padding:0 0 2px}
.memory-swipe-body .memory-swipe-heading{min-width:0;overflow-wrap:anywhere}
.memory-swipe-body .memory-swipe-heading time{display:block}
.memory-swipe-body .memory-swipe-heading h3{margin:7px 0 8px;line-height:1.45}
.memory :deep(.swipe-row){border-radius:8px}
.memory :deep(.swipe-content){background:#fff}
.memory :deep(.swipe-actions){align-items:stretch;background:#fff}
.memory :deep(.swipe-actions button){align-self:stretch;height:auto;min-height:0;flex:0 0 72px}
.memory-photos img{width:100%;height:165px;object-fit:cover;border-radius:12px}
.memory-photos button{margin-top:3px}
.memory-heading-content{display:flex;align-items:center;justify-content:space-between;gap:12px}
.memory-heading-content h3{min-width:0;flex:1}
.memory-add-photo{flex:none;display:grid;place-items:center;position:relative;
 width:34px;height:34px;border:1px solid #c8ddcc;border-radius:50%;
 background:#eff7f0;color:#45876a;cursor:pointer}
.memory-add-photo input{position:absolute;inset:0;opacity:0;width:100%;height:100%;
 cursor:pointer;font-size:0}
.memory-add-photo:focus-within{outline:2px solid #43866a;outline-offset:2px}
.memory-photo-button{display:block;width:100%;aspect-ratio:1;overflow:hidden;padding:0;
 border:0;border-radius:12px;background:#edf2ed;cursor:zoom-in;margin:0!important}
.memory-photo-button img{display:block;width:100%;height:100%;object-fit:cover}
.memory-more-photos{display:block;width:100%;margin:9px 0 6px;padding:7px;border:0;
 border-radius:9px;background:#edf5ed;color:#43866a;font-size:12px;font-weight:650}
.memory-more-photos:disabled{opacity:.6}
@media(max-width:720px){.life-grid{grid-template-columns:1fr}.life-card{padding:17px}}

/* Shared icon language and responsive form guards */
.life-section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;margin:0 0 12px}
.life-section-heading .life-heading{margin:0;flex:1;min-width:0;line-height:1.35}
.life-section-heading .section-add-button{flex:none}
.life-heading{display:flex;align-items:center;gap:9px;color:#293f34;min-width:0}
.life-heading :deep(.app-icon){color:#43866a}
.memory-visibility{display:inline-flex;align-items:center;gap:5px;max-width:100%;white-space:nowrap}
.memory-visibility :deep(.app-icon),.memory-audience{flex:none}
.memory-attribution{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.life-form,.life-card,.life-row,.trip-import,.trip-detail{min-width:0;max-width:100%}
.life-row>*{min-width:0;overflow-wrap:anywhere}
.life-row>button{flex:none}
.life-form input:not([type="checkbox"]),.life-form select,.life-form textarea,
.trip-import select,.trip-import textarea{width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.life-form input[type="date"]{min-inline-size:0}
.life-form label,.trip-import label{min-width:0;max-width:100%}
.life-form button{width:100%}
.life-form .life-cancel{background:#fff;color:#43866a;border:1px solid #9ac2a8}
.life-details{min-width:0;flex:1}
/* Savings goals use one full-width information column, never a squeezed
   left column beside a large action card. Tap surfaces stay 44px tall while
   their visual weight remains light on iPhone. */
.goal-plan-row{display:block!important;min-width:0;max-width:100%;padding:8px 0 2px!important}
.goal-plan-row>.life-details{width:100%;min-width:0;max-width:100%}
.goal-plan-row .detail-name{display:block;margin:0 0 3px;font-size:14px;line-height:1.45}
.goal-amount-line{display:flex!important;align-items:center;flex-wrap:wrap;gap:0 9px;
  min-width:0;max-width:100%;line-height:1.5}
.goal-amount-line>span{min-width:0;overflow-wrap:anywhere}
.goal-plan-row .goal-wish-link{display:inline-flex;align-items:center;justify-content:center;gap:4px;
  flex:none;min-width:0;min-height:32px;padding:0 2px;border:0;border-radius:5px;position:relative;
  background:transparent;color:var(--hf-success-text);
  font:inherit;font-size:11px;font-weight:650;line-height:1.3;white-space:nowrap;
  touch-action:manipulation}
.goal-plan-row .goal-dates{margin-top:0;line-height:1.55}
.goal-row-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;
  min-width:0;margin-top:0}
.goal-plan-row .goal-finance-action{display:inline-flex;align-items:center;justify-content:flex-end;
  flex:none;gap:4px;min-height:32px;padding:0 2px;border:0;border-radius:7px;position:relative;
  background:transparent;color:var(--ui-brand,#357b5c);
  font-size:12px;font-weight:700;line-height:1.4;white-space:nowrap;touch-action:manipulation}
/* The invisible extension preserves a 44px tap target without adding an
   empty-looking 44px control box below the status text. */
.goal-plan-row :is(.goal-wish-link,.goal-finance-action)::before{
  content:'';position:absolute;inset:-6px -3px
}
.goal-finance-chevron{transform:rotate(-90deg)}
.goal-plan-row :is(.goal-wish-link,.goal-finance-action):focus-visible{
  outline:2px solid #43866a;outline-offset:2px}
@media(max-width:380px){.goal-amount-line{column-gap:5px}
 .goal-plan-row .goal-finance-action{font-size:11px}}

.detail-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:5px;flex:none}
.life-row .detail-actions .life-link{font-size:11px;padding:6px 8px;min-width:0}
.life-danger{color:#a45b4c!important;background:#faefeb!important}
.detail-completed .detail-name{text-decoration:line-through;color:#9ba99f}
.detail-completed small{color:#a1aea5}
.shopping-check{display:flex;align-items:center;gap:9px;flex:1;min-width:0}
.shopping-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap;flex:none;max-width:53%}
.shopping-row-actions .routine-more-trigger{flex:none}
/* Keep shopping rows as one continuous item with a single solid separator. */
.shopping-plan-entry{min-width:0;border-bottom:1px solid #e5ece6}
.shopping-plan-entry:last-of-type{border-bottom:0}
.shopping-plan-entry .shopping-line{border-bottom:0}
.shopping-plan-entry .shopping-inline-actions{border-top:0;margin:0;padding:0 0 11px}
@media(max-width:440px){.shopping-row-actions{max-width:49%}.shopping-row-actions .life-link{font-size:11px;padding:7px 8px}}
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

/* One compact plan-filter surface, with dates only when history is selected. */
.plan-view-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:9px;min-height:38px}
.plan-view-heading>b{font-size:14px;font-weight:750;color:#314b3a}
.plan-view-toolbar{margin:10px 0 15px;padding:11px 12px 5px;
  background:#fff;border:1px solid #eeebe5;border-radius:16px}
.plan-view-toolbar .plan-filter-tabs{gap:7px;padding:0 0 10px}
.plan-view-toolbar .archive-toolbar{background:transparent;border:0;border-top:1px solid #edf0eb;
  border-radius:0;padding:10px 0 0;margin:0 0 7px}
.plan-view-toolbar .archive-toolbar>.life-filter-trigger{
  display:flex;align-items:center;justify-content:center;
  min-height:36px;margin:12px 0 3px auto;padding:7px 12px;
  width:max-content;max-width:100%;border-radius:10px;
  font-size:12px;line-height:1.35;white-space:nowrap
}
.plan-view-toolbar .archive-date-filters{margin:12px 0 6px;gap:8px}
.plan-view-toolbar .plan-history-date-filters{margin:10px 0 4px;grid-template-columns:repeat(3,minmax(0,1fr))}
.plan-view-toolbar .archive-date-filters label{font-size:11px}
.plan-view-toolbar .archive-date-filters select{min-height:38px}
.plan-view-toolbar .archive-tabs button{min-height:37px}
.trip-import{padding:2px 0 0;margin-top:0;background:transparent}
.trip-import label{display:grid;gap:8px;color:#526c5b;font-size:13px;font-weight:650;line-height:1.45}
.trip-import textarea{display:block;min-height:124px;max-height:32dvh;margin:12px 0 12px;
  padding:11px 12px;line-height:1.45;resize:vertical;font-size:16px}
.trip-import>.life-light{width:100%;min-height:44px;padding:10px 14px;
  background:#edf5ef;border:1px solid #c8dfd0;color:#397e59;font-size:13px;font-weight:700}
.trip-import :is(select,textarea):focus-visible{outline:2px solid #43866a;outline-offset:1px}
.life-form select,.trip-import select,.archive-date-filters select,.plan-recap-controls select{
  display:block;box-sizing:border-box;appearance:none;-webkit-appearance:none;
  width:100%;max-width:100%;min-width:0;min-height:44px;
  border:1px solid #d5e2d8;border-radius:11px;
  background-color:#fff;
  background-image:linear-gradient(45deg,transparent 50%,#6b8773 50%),
    linear-gradient(135deg,#6b8773 50%,transparent 50%);
  background-position:calc(100% - 19px) calc(50% - 1px),calc(100% - 14px) calc(50% - 1px);
  background-size:5px 5px,5px 5px;background-repeat:no-repeat;
  color:#293f34;font-family:inherit;font-size:16px;line-height:1.35;
  padding:10px 36px 10px 12px;box-shadow:none
}
.life-form select:focus-visible,.archive-date-filters select:focus-visible,
.plan-recap-controls select:focus-visible{
  outline:2px solid #43866a;outline-offset:1px
}
.plan-recap{margin:10px 0 16px}
.plan-tasks-card .plan-task-item.focused-plan-entry{
  background:#f7fbf8;box-shadow:inset 3px 0 0 #72aa88;
  border-radius:8px;padding:11px 9px;margin:0}
.plan-tasks-card .plan-task-item.focused-plan-entry :deep(.swipe-content){background:#f7fbf8}
@media(max-width:480px){
  .plan-view-toolbar{padding:10px 11px 4px}
  .plan-view-toolbar .plan-filter-tabs button{padding:7px 11px}
  .plan-tasks-card .plan-task-item{padding:10px 0}
  .plan-task-head .routine-more-trigger{width:30px;height:30px}
}

/* Unified compact mobile list hierarchy for travel, savings and shopping. */
.trip-plan-row{display:block!important;min-width:0;padding-block:9px}
.trip-plan-row>.life-details{min-width:0;width:100%}
.trip-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0}
.trip-title-row>.detail-name{min-width:0;flex:1;overflow-wrap:anywhere}
.trip-title-row :deep(.hf-status){flex:none;margin-top:2px}
.trip-plan-row .trip-summary-line{display:block;margin-top:4px;line-height:1.5}
.trip-participant-actions{display:flex;align-items:center;justify-content:space-between;
  gap:6px;min-width:0;margin-top:5px;color:#718578;font-size:12px;line-height:1.45}
.trip-participant-names{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trip-plan-row .trip-card-actions{max-width:none;flex:none;justify-content:flex-end;flex-wrap:nowrap;gap:5px;margin-left:auto}
.trip-plan-row .trip-card-actions .life-link{min-height:38px;padding:8px 10px}
.routine-description-row{display:flex;align-items:center;justify-content:space-between;
  gap:6px;min-width:0}
.routine-description-row>.routine-meta{flex:1;min-width:0;margin:0;overflow-wrap:anywhere}
.routine-description-row>.routine-more-trigger{flex:none;margin-left:auto;margin-block:0;
  position:relative;width:28px;height:28px;min-width:28px;min-height:28px;
  padding:0;border:0;border-radius:6px;background:transparent;color:#789487}
.routine-description-row>.routine-more-trigger[aria-expanded="true"]{
  background:transparent;color:#397e5f}
.routine-description-row>.routine-more-trigger::before{
  content:'';position:absolute;inset:-8px}
.routine-description-row>.routine-more-trigger:focus-visible{
  outline:2px solid #43866a;outline-offset:2px}
.once-task-description-row>.once-task-summary{flex:1;min-width:0;margin:0;
  line-height:1.45;overflow-wrap:anywhere}
.once-task-description-row>.routine-more-trigger{flex:none;margin-left:auto;
  width:28px;height:28px;min-width:28px;min-height:28px}
.goal-title-row,.shopping-title-row{display:flex;align-items:flex-start;
  justify-content:space-between;gap:10px;min-width:0}
.goal-title-row>.detail-name,.shopping-title-row>.detail-name{
  flex:1;min-width:0;overflow-wrap:anywhere}
.goal-title-row :deep(.hf-status),.shopping-title-row :deep(.hf-status){
  flex:none;margin-top:2px}
.goal-plan-row .goal-dates{flex:1;min-width:0;overflow-wrap:anywhere}
.goal-row-footer{justify-content:flex-end;gap:8px}
.shopping-plans-card>.life-heading{margin-bottom:5px}
.shopping-plan-entry .shopping-line{display:block;min-width:0;padding:4px 0}
.shopping-plan-content{width:100%;min-width:0}
.shopping-title-row{align-items:center}
.shopping-title-row>.detail-name{display:block;font-size:14px;line-height:1.45}
.shopping-title-row>.detail-name>small{display:inline;font-size:11px;margin:0}
.shopping-heading-end{display:flex;align-items:center;justify-content:flex-end;
  flex:none;gap:9px;margin-left:auto;min-width:0}
.shopping-heading-end :deep(.hf-status){flex:none;margin-top:0}
.shopping-heading-end .shopping-ledger-icon{display:inline-grid;place-items:center;
  position:relative;flex:none;width:24px;height:24px;min-width:24px;min-height:24px;
  padding:0;border:0;border-radius:8px;background:transparent;
  color:#789487;box-shadow:none;touch-action:manipulation}
.shopping-heading-end .shopping-ledger-icon.is-linked{color:var(--ui-brand,#357b5c)}
.shopping-heading-end .shopping-ledger-icon::before{
  content:'';position:absolute;inset:-10px}
.shopping-heading-end .shopping-ledger-icon:focus-visible{
  outline:2px solid #43866a;outline-offset:2px}
.shopping-meta-row{display:flex;align-items:center;justify-content:space-between;
  gap:7px;min-width:0;margin-top:0}
.shopping-meta-row>.shopping-plan-date{flex:1;min-width:0;margin:0;
  line-height:1.4;overflow-wrap:anywhere}
.shopping-meta-row .shopping-more-trigger{flex:none;position:relative;
  width:24px;min-width:24px;height:24px;min-height:24px;
  padding:0;margin-left:auto;border-radius:6px}
.shopping-meta-row .shopping-more-trigger::before{
  content:'';position:absolute;inset:-10px}
.shopping-handler-row{display:flex;align-items:center;justify-content:space-between;
  gap:6px;min-width:0;margin-top:0}
.shopping-handler-row>.shopping-assignees{display:block;flex:1;min-width:0;
  margin:0;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shopping-handler-row .shopping-row-actions{display:flex;align-items:center;
  justify-content:flex-end;flex:none;max-width:none;gap:5px;
  flex-wrap:nowrap;margin-left:auto}
.shopping-handler-row .shopping-row-actions .life-link{min-height:32px;
  padding:4px 7px;font-size:11px}
@media(max-width:380px){
 .trip-participant-actions{gap:4px}
 .trip-plan-row .trip-card-actions{max-width:none;gap:3px}
 .trip-plan-row .trip-card-actions .life-link{padding-inline:7px}
 .shopping-handler-row{gap:4px}
 .shopping-handler-row .shopping-row-actions{gap:3px}
 .shopping-handler-row .shopping-row-actions .life-link{padding:4px 5px}
}

.anniversary-archived-tag{color:#4a8062;font-weight:600}
/* Family anniversaries: keep the filter and empty state tight on phones. */
.anniversary-card .anniversary-controls{display:grid;gap:14px}
.anniversary-card .anniversary-filter-row{display:flex;justify-content:flex-end;min-width:0}
.anniversary-card .anniversary-filter-row .life-filter-trigger{
 display:inline-flex;align-items:center;justify-content:center;gap:6px;
 min-height:36px;max-width:100%;padding:7px 11px;
 line-height:1.35;white-space:normal;text-align:left;
}
.anniversary-card .anniversary-filter-row .life-filter-trigger :deep(.app-icon){flex:none}
.anniversary-card .anniversary-empty{
 margin:8px 0 0;padding:10px 6px 2px;line-height:1.6;
}
</style>

<style scoped>
.trip-participant-summary{display:flex;flex-wrap:wrap;gap:4px 12px;padding:3px 0 10px;font-size:12px;color:#526d5c;line-height:1.45}
.trip-participant-summary>span{min-width:0;overflow-wrap:anywhere}
.task-push-form{display:grid;gap:10px;padding:12px 10px;margin:6px 0 10px;border:1px solid #d9e9dc;border-radius:12px;background:#f8fbf8;min-width:0}
.task-push-form label{display:grid;gap:6px;font-size:12px;color:#425b4b;font-weight:650;min-width:0}
.task-push-form textarea{width:100%;max-width:100%;min-width:0;box-sizing:border-box;border:1px solid #ccdcd0;border-radius:9px;padding:10px;font:inherit;font-size:14px;resize:vertical;background:#fff;color:#263b2e}
.task-push-actions{display:flex;justify-content:flex-end;gap:8px}
.task-push-actions button{border:1px solid #ccdcd0;border-radius:8px;background:#fff;padding:8px 12px;color:#3b7054;font-weight:650;font-size:12px}
.task-push-actions button[type=submit]{background:#43866a;color:#fff;border-color:#43866a}
.task-push-actions button:disabled{opacity:.6}
.task-push-error{margin:0;padding:10px 12px;border:1px solid #f1d3cd;border-radius:10px;
 background:#fff2ef;color:#a13e34;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.task-push-form button[aria-busy="true"]{opacity:.65;cursor:progress}


/* One-time task editor lives in LifePanel; sibling component scoped CSS does
   not reach it. Keep every field in its own bounded mobile row. */
.once-task-identity{display:flex!important;flex-wrap:wrap;column-gap:12px;row-gap:3px}
.once-task-identity span{min-width:0;max-width:100%;overflow-wrap:anywhere}
.once-task-editor{
  display:grid;grid-template-columns:minmax(0,1fr);gap:12px;
  width:100%;max-width:100%;min-width:0;box-sizing:border-box;
  margin:0;padding:0;border:0;
  border-radius:0;background:transparent
}
.once-task-editor .once-editor-title{
  display:block;font-size:14px;font-weight:700;line-height:1.5;
  color:#334d3d;margin:0 0 1px
}
.once-task-editor .once-edit-field{
  display:grid;grid-template-columns:minmax(0,1fr);gap:6px;
  min-width:0;max-width:100%;font-size:12px;font-weight:600;
  line-height:1.5;color:#617669
}
.once-task-editor .once-edit-field>span{display:block;min-width:0}
.once-task-editor .once-edit-field>input,
.once-task-editor .once-edit-field>select{
  display:block;box-sizing:border-box;
  inline-size:100%;min-inline-size:0;max-inline-size:100%;
  block-size:44px;min-block-size:44px;padding:9px 12px;
  border:1px solid #d4e0d6;border-radius:10px;
  background:#fff;color:#273e30;font-size:16px;
  text-overflow:ellipsis
}
.once-task-editor .once-edit-field>select{white-space:nowrap;overflow:hidden}
.once-task-editor .once-edit-field :deep(.date-field){
  inline-size:100%;min-inline-size:0;max-inline-size:100%
}
.once-task-editor .once-edit-remind{
  display:flex;align-items:center;gap:10px;min-width:0;
  padding:2px 0;font-size:13px;font-weight:500;color:#344a3a
}
.once-task-editor .once-edit-remind>input[type="checkbox"]{
  flex:0 0 19px;inline-size:19px;block-size:19px;margin:0;
  accent-color:#43866a
}
.once-task-editor .once-edit-actions{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  align-items:stretch;gap:10px;margin-top:3px;min-width:0
}
.once-task-editor .once-edit-actions>button{
  min-width:0;min-height:42px;border-radius:10px;
  border:1px solid #c9dccc;background:#fff;color:#547a61;
  font-size:13px;font-weight:700;padding:9px 11px
}
.once-task-editor .once-edit-actions>button[type="submit"]{
  border-color:#43866a;background:#43866a;color:#fff
}
.once-task-editor .once-edit-field>input:focus-visible,
.once-task-editor .once-edit-field>select:focus-visible,
.once-task-editor .once-edit-actions>button:focus-visible{
  outline:2px solid #43866a;outline-offset:2px
}
@media(max-width:480px){
  .once-task-editor{padding:12px;gap:11px}
  .once-task-editor .once-edit-actions{gap:8px}
}

/* Assignment form is teleported to body: .shell rules don't apply there. */
.routine-assignment-form{
 display:grid;gap:14px;margin:0;padding:0;border:0;border-radius:0;background:transparent;
 min-width:0;max-width:100%;
}
.routine-assignment-summary{
 display:grid;gap:3px;padding:10px 12px;background:#f5f8f5;border-radius:10px;
 min-width:0;overflow-wrap:anywhere;
}
.routine-assignment-summary span{color:#718575;font-size:12px;line-height:1.4}
.routine-assignment-summary b{color:#304b3a;font-size:14px;line-height:1.5}
.routine-assignment-form label{display:grid;gap:7px;min-width:0;color:#536b5d;font-size:13px;font-weight:650}
.routine-assignment-form select,.routine-assignment-form input[type=number]{
 display:block;box-sizing:border-box;appearance:none;-webkit-appearance:none;
 width:100%;max-width:100%;min-width:0;min-height:44px;height:44px;
 padding:9px 12px;border:1px solid #d4e1d6;border-radius:10px;
 background:#fff;color:#293e32;font-size:16px;line-height:1.4;box-shadow:none
}
.routine-assignment-form select{
 padding-right:36px;
 background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23698572' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
 background-repeat:no-repeat;background-size:16px 16px;background-position:right 12px center
}
.routine-assignment-form :is(select,input):focus-visible{outline:2px solid #43866a;outline-offset:2px}
.routine-assignment-form label small{font-size:12px;font-weight:400;color:#748778;line-height:1.45}
.routine-assignment-error{margin:0;padding:10px 12px;background:#fff2ec;color:#a04437;border-radius:10px;font-size:13px;line-height:1.5}
.routine-assignment-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.55fr);gap:10px;margin-top:2px}
.routine-assignment-actions button{min-width:0;min-height:44px;border-radius:10px;font-size:14px;padding:9px 12px}
.routine-assignment-actions button[type=submit]{background:#43866a;color:#fff;border-color:#43866a}
</style>
