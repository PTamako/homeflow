<script setup lang="ts">
import DateField from './components/DateField.vue'
import {computed,onMounted,onBeforeUnmount,nextTick,ref,watch} from 'vue'
import {listPending,sendOrQueueTask,syncPending,removePending,type PendingTaskOp} from './offline-tasks'
import {validLocalPassword,registerPassword,loginPassword} from './auth-crypto'
import LifePanel from './components/LifePanel.vue'
import LifeItemEditor from './components/LifeItemEditor.vue'
import GlobalSearch from './components/GlobalSearch.vue'
import ManagePage from './components/ManagePage.vue'
import PetHealthPanel from './components/PetHealthPanel.vue'
import ProfileEditor from './components/ProfileEditor.vue'
import AppIcon from './components/AppIcon.vue'
import SwipeActions from './components/SwipeActions.vue'
import PageToast from './components/PageToast.vue'
import {usePageToast} from './page-toast'
type User={id:string;loginName:string;role:'owner'|'member';householdId:string;householdName:string}
type Profile={id:string;memberUserId:string|null;type:'person'|'pet';displayName:string;birthday:string|null;relation:string;adoptedOn:string|null;weightGrams:number|null;notes:string}
type Task={id:string;title:string;notes:string;visibility:'private'|'household';dueOn:string|null;creatorUserId:string;subjectProfileId:string|null;assigneeUserId:string|null;healthRecordType:string|null;completedAt:string|null;updatedAt:string}
type Routine=Record<string,any>
type PlanKind='shopping'|'wish'|'goal'|'trip'
type TodayKind='task'|'routine'|PlanKind
type GoalReview={id:string;kind:'goal';title:string;periodKey:string;dueOn:string;pendingCount:number;reviewType:'pending'|'due_today'|'due_soon';targetAmount:number}
type TodayPlan={id:string;kind:PlanKind;title:string;dueOn:string;done:boolean;overdue:boolean;destination?:string;periodKey?:string;tripEnded?:boolean;ledgerEntryId?:string|null}
type TodayEntry={key:string;kind:TodayKind;title:string;done:boolean;task?:Task;routine?:Routine;plan?:TodayPlan}
const todayKindLabels:Record<TodayKind,string>={task:'待办',routine:'定期',shopping:'购物',wish:'心愿',goal:'储值',trip:'旅行'}
const todayCategories:Array<{id:'all'|TodayKind;label:string}>=[
 {id:'all',label:'全部'},{id:'task',label:'待办'},{id:'routine',label:'定期'},
 {id:'shopping',label:'购物'},{id:'wish',label:'心愿'},{id:'goal',label:'储值'},{id:'trip',label:'旅行'}
]
type Data={hiddenTodayKeys?:string[];goalReviews?:GoalReview[];ok?:boolean;error?:string;initialized?:boolean;bootstrapAvailable?:boolean;bootstrapIssue?:'missing'|'too_short'|null;user?:User;profiles?:Profile[];tasks?:Task[];items?:Routine[];invitationCode?:string}
const user=ref<User|null>(null),profiles=ref<Profile[]>([]),tasks=ref<Task[]>([])
// Distinguish session loading from signed-out state.
const authReady=ref(false)
const authFailure=ref('')
const todayRoutines=ref<Routine[]>([]),todayPlans=ref<TodayPlan[]>([])
const dismissedTodayKeys=ref<string[]>([])
const goalReviews=ref<GoalReview[]>([])
const todayCategory=ref<'all'|TodayKind>('all')
const listPageSize=5
const todayVisibleCount=ref(listPageSize)
const pendingVisibleCount=ref(listPageSize)
const peopleVisibleCount=ref(listPageSize)
const petsVisibleCount=ref(listPageSize)
const editingRoutine=ref<Routine|null>(null),routineBusy=ref(false)
const tab=ref<'today'|'family'|'plans'|'memories'|'manage'>('today')
const hasImportantReminders=ref(false)
const importantRemindersRef=ref<{refreshIfStale:()=>void}|null>(null)
const focusPlanType=ref('all')
const focusPlanId=ref('')
const focusPlanPeriodKey=ref('')
const focusPlanScope=ref<'active'|'history'>('active')
const focusPlanFromToday=ref(false)
const focusPlanRequest=ref(0)
const openPlanCreatorOnNavigate=ref(false)
let savedTodayScrollY=0
let returningToToday=false
function openPlans(kind:string,id='',periodKey='',done=false){
  openPlanCreatorOnNavigate.value=false
  focusPlanFromToday.value=tab.value==='today'&&!!id
  if(focusPlanFromToday.value)savedTodayScrollY=window.scrollY
  focusPlanType.value=kind
  focusPlanId.value=id
  focusPlanPeriodKey.value=periodKey
  focusPlanScope.value=done&&(kind==='routine'||kind==='wish'||(kind==='goal'&&(!periodKey||periodKey==='once')))
    ?'history':'active'
  focusPlanRequest.value++
  tab.value='plans'
}
async function returnToToday(){
  returningToToday=true
  tab.value='today'
  await nextTick()
  await reloadToday()
  await nextTick()
  window.requestAnimationFrame(()=>window.scrollTo({top:savedTodayScrollY,behavior:'instant'}))
  returningToToday=false
}
function openSearchResult(result:{id:string;kind:string}){
 if(['shopping','wish','goal','trip','task','routine'].includes(result.kind))
   openPlans(result.kind,result.id)
 else {
   focusPlanType.value=result.kind
   focusPlanId.value=result.id
   focusPlanPeriodKey.value=''
   focusPlanScope.value='active'
   focusPlanFromToday.value=false
   focusPlanRequest.value++
   tab.value=result.kind==='memory'?'memories':'family'
 }
}
function navigateTab(value:typeof tab.value){
  openPlanCreatorOnNavigate.value=false
  if(value==='plans'){
    focusPlanId.value=''
    focusPlanPeriodKey.value=''
    focusPlanScope.value='active'
    focusPlanFromToday.value=false
    focusPlanRequest.value++
  }
  tab.value=value
}
function openNewTaskInPlans(){
  navigateTab('plans')
  focusPlanType.value='all'
  openPlanCreatorOnNavigate.value=true
}
const authMode=ref<'login'|'bootstrap'|'join'|'recover'>('login'),initialized=ref(true),loading=ref(false)
const bootstrapIssue=ref<'missing'|'too_short'|null>(null)
const login=ref(''),password=ref(''),displayName=ref(''),householdName=ref('我们的小家'),bootstrapSecret=ref(''),invite=ref(''),recoveryCode=ref(''),recoveryConfirm=ref('')
const editingTask=ref<{id:string;title:string;notes:string;visibility:'private'|'household';dueOn:string;
  assigneeUserId:string|null;subjectProfileId:string;healthRecordType:string;expectedUpdatedAt:string}|null>(null)
const name=ref(''),petType=ref<'pet'|'person'>('pet'),birth=ref(''),adopted=ref('')
const showProfileForm=ref(false)
function closeProfileForm(){
  showProfileForm.value=false
  name.value='';petType.value='pet';birth.value='';adopted.value=''
}
function toggleProfileForm(){
  if(showProfileForm.value)closeProfileForm()
  else showProfileForm.value=true
}
const error=ref('')
const {toast,notify,clear:clearToast}=usePageToast()
const pendingTasks=ref<PendingTaskOp[]>([]),syncMessage=ref('')
const openPetId=ref<string|null>(null)
const editProfileId=ref<string|null>(null),profileRevision=ref(0)
const nav=[{id:'today',icon:'sun',label:'今天'},{id:'plans',icon:'clipboard-check',label:'计划'},{id:'memories',icon:'images',label:'时光轴'},{id:'family',icon:'house',label:'家庭'},{id:'manage',icon:'settings',label:'管理'}] as const
function tokyoToday(){return new Date(Date.now()+9*3600000).toISOString().slice(0,10)}
function tokyoDate(timestamp:string){
 const iso=timestamp.includes('T')?timestamp:timestamp.replace(' ','T')+'Z'
 const n=Date.parse(iso)
 return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,10):''
}
const currentJstDay=ref(tokyoToday())
const visibleTasks=computed(()=>tasks.value.filter(t=>{
 const now=currentJstDay.value
 return t.completedAt?tokyoDate(t.completedAt)===now:
   !!t.dueOn&&t.dueOn<=now
}))
const allToday=computed<TodayEntry[]>(()=>{
  const standard:TodayEntry[]=visibleTasks.value.map(task=>({
    key:'task:'+task.id,kind:'task',title:task.title,done:!!task.completedAt,task
  }))
  const recurring:TodayEntry[]=todayRoutines.value.map(routine=>({
    key:'routine:'+routine.id+':'+(routine.occurrenceOn||''),kind:'routine',title:routine.title,done:!!routine.mark?.completed_at,routine
  }))
  // All plan types use one visual list, while retaining each source's own
  // completion, privacy and recurrence rules.
  const plans:TodayEntry[]=todayPlans.value.map(plan=>({
    key:'plan:'+plan.kind+':'+plan.id+(plan.periodKey?':'+plan.periodKey:''),kind:plan.kind,
    title:plan.title,done:plan.done,plan
  }))
  return [...standard,...recurring,...plans]
    .filter(row=>!dismissedTodayKeys.value.includes(row.key))
    .sort((a,b)=>Number(a.done)-Number(b.done))
})
const todayEntryKeys=computed(()=>allToday.value.map(row=>row.key))
const visibleTodayCategories=computed(()=>todayCategories.filter(category=>
  category.id==='all'||allToday.value.some(row=>row.kind===category.id)))
const unifiedToday=computed(()=>todayCategory.value==='all'?allToday.value:
  allToday.value.filter(row=>row.kind===todayCategory.value))
watch(visibleTodayCategories,categories=>{
  if(!categories.some(category=>category.id===todayCategory.value))todayCategory.value='all'
})
const completedTodayCount=computed(()=>unifiedToday.value.filter(row=>row.done).length)
const visibleToday=computed(()=>unifiedToday.value.slice(0,todayVisibleCount.value))
const visiblePendingTasks=computed(()=>pendingTasks.value.slice(0,pendingVisibleCount.value))
function recurringLabel(r:Routine){
  let c:any={}
  try{c=typeof r.repeat_config==='string'?JSON.parse(r.repeat_config):r.repeat_config||{}}catch{}
  if(r.repeat_type==='daily')return '每天'
  if(r.repeat_type==='weekly'&&c.excludeJapaneseHolidays)return '工作日'
  if(r.repeat_type==='weekly')return '每周'+(c.weekdays||[]).map((d:number)=>'日一二三四五六'[d]).join('、')
  if(r.repeat_type==='monthly')return '每月'+Number(c.day||1)+'日'
  if(r.repeat_type==='interval')return '每'+Number(c.days||0)+'天'
  return '定期'
}
const pets=computed(()=>profiles.value.filter(p=>p.type==='pet'))
const isPet=(id:string|null|undefined)=>profiles.value.some(p=>p.id===id&&p.type==='pet')
const nameForProfile=(id:string|null|undefined)=>profiles.value.find(p=>p.id===id)?.displayName||''
const editTaskPet=computed(()=>isPet(editingTask.value?.subjectProfileId))
function changedEditingSubject(){
 if(editingTask.value)editingTask.value.healthRecordType=isPet(editingTask.value.subjectProfileId)?'other':''
}
const people=computed(()=>profiles.value.filter(p=>p.type==='person'))
const visiblePeople=computed(()=>people.value.slice(0,peopleVisibleCount.value))
const visiblePets=computed(()=>pets.value.slice(0,petsVisibleCount.value))
watch([todayCategory,currentJstDay],()=>{todayVisibleCount.value=listPageSize})
function togglePet(id:string){openPetId.value=openPetId.value===id?null:id}
function canEditProfile(p:Profile){return user.value?.role==='owner'||p.memberUserId===user.value?.id}
function toggleProfileEdit(id:string){editProfileId.value=editProfileId.value===id?null:id}
async function openBirthdayProfileEditor(id:string){
  const profile=profiles.value.find(p=>p.id===id)
  if(!profile||!canEditProfile(profile))return
  tab.value='family'
  await nextTick()
  const list=profile.type==='pet'?pets.value:people.value
  const index=list.findIndex(p=>p.id===id)
  if(index>=0){
    const count=Math.ceil((index+1)/listPageSize)*listPageSize
    if(profile.type==='pet')petsVisibleCount.value=Math.max(petsVisibleCount.value,count)
    else peopleVisibleCount.value=Math.max(peopleVisibleCount.value,count)
  }
  editProfileId.value=id
  if(profile.type==='pet')openPetId.value=id
  await nextTick()
  document.getElementById('profile-'+id)?.scrollIntoView({behavior:'smooth',block:'center'})
}
async function profileSaved(){
  try{
    const next=await api('/family')
    profiles.value=next.profiles||[]
    profileRevision.value++
    editProfileId.value=null
    error.value=''
    notify('档案已保存')
  }catch(e){error.value=(e as Error).message}
}
const errText=(key:string)=>{
  const map:Record<string,string>={invalid_credentials:'账号或密码错误',invalid_input:'输入格式不符合要求，请检查所有字段。',
    invalid_login_name:'登录账号格式不正确：请使用邮箱地址，或 3～36 位英文用户名（可包含数字、点、下划线和连字符）。',
    invalid_password:'密码需为 12～128 个字符，UTF-8 编码不超过 300 字节。',
    invalid_password_proof:'密码安全验证数据无效。请刷新页面并重新输入密码。',
    invalid_password_salt:'密码安全参数异常，请刷新页面重试。',
    login_challenge_unavailable:'无法获取登录安全参数，请刷新页面重试。',
    invalid_display_name:'昵称需为 1～60 个字符，可使用中文、日文、英文字母和数字。',
    login_name_taken:'这个登录账号已经被使用，请换一个。',
    invalid_invitation_code:'邀请码格式不正确，请向家人重新获取。',
    bootstrap_not_configured:'请先在生产 Worker 配置 HOMEFLOW_BOOTSTRAP_SECRET',bootstrap_secret_too_short:'已找到 Cloudflare Secret，但长度不足 32 字符。请在生产 Worker 重设为至少 32 位随机值。',bootstrap_not_authorized:'启动密钥不正确',
    not_authenticated:'请登录',conflict_or_expired:'邀请码过期、已使用或账号重复',household_full:'家庭已有两个账号',
    too_many_attempts:'尝试次数过多，请稍后重试',environment_or_database_not_ready:'数据库迁移或绑定尚未完成',
    origin_forbidden:'请使用正确的 HomeFlow 网址',forbidden:'没有访问权限'}
  return map[key]||key
}
async function api(path:string,method='GET',payload?:unknown):Promise<Data>{
  const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
    ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})})
  let data:Data
  try{data=await response.json() as Data}catch{throw Error('服务器响应异常')}
  if(!response.ok)throw Error(errText(data.error||String(response.status)))
  return data
}
async function refresh(){
  authFailure.value=''
  try{
    user.value=(await api('/auth/me')).user||null
  }catch(e){
    // Only an actual 401 means signed out. Network or database errors must
    // never show a misleading login form or clear the existing session state.
    if((e as Error).message!=='请登录'){
      authFailure.value=(e as Error).message
      return
    }
    user.value=null;pendingTasks.value=[]
  }
  if(user.value){
    try{
      // Today data is loaded once by reloadToday after authentication.
      // Avoid duplicate D1 task and routine reads during the initial session check.
      const a=await api('/family')
      profiles.value=a.profiles||[]
      try{pendingTasks.value=await listPending(user.value.id)}catch{pendingTasks.value=[]}
    }catch(e){error.value=(e as Error).message}
  }else{
    try{
      const status=await api('/auth/bootstrap-status')
      initialized.value=!!status.initialized
      bootstrapIssue.value=status.bootstrapIssue||null
      if(!status.initialized)authMode.value='bootstrap'
    }catch(e){authFailure.value=(e as Error).message}
  }
}
async function retryAuth(){
  authReady.value=false
  try{
    await refresh()
    if(user.value&&tab.value==='today')await reloadToday()
  }finally{authReady.value=true}
}
async function submitAuth(){
  error.value='';loading.value=true
  try{
    if(!validLocalPassword(password.value))throw new Error(errText('invalid_password'))
    const details={loginName:login.value,displayName:displayName.value}
    if(authMode.value==='bootstrap'){
      const proof=await registerPassword(password.value)
      await api('/auth/bootstrap','POST',{...details,...proof,householdName:householdName.value,bootstrapSecret:bootstrapSecret.value})
    } else if(authMode.value==='join'){
      const proof=await registerPassword(password.value)
      await api('/auth/join','POST',{...details,...proof,invitationCode:invite.value})
    } else if(authMode.value==='recover'){
      if(password.value!==recoveryConfirm.value)throw Error('两次输入的新密码不一致')
      if(!/^[a-f0-9]{32}$/i.test(recoveryCode.value.trim()))throw Error('恢复码应为32位字符')
      const fresh=await registerPassword(password.value)
      await api('/auth/recover','POST',{loginName:login.value,recoveryCode:recoveryCode.value.trim().toLowerCase(),
        newPasswordProof:fresh.passwordProof,newPasswordSalt:fresh.passwordSalt,
        newPasswordRounds:fresh.passwordRounds})
      authMode.value='login';password.value='';recoveryConfirm.value='';recoveryCode.value=''
      notify('密码重置成功，请使用新密码登录')
      return
    } else {
      const proof=await loginPassword(login.value,password.value)
      await api('/auth/login','POST',{loginName:login.value,...proof})
    }
    password.value='';bootstrapSecret.value='';invite.value=''
    await refresh()
    if(user.value&&tab.value==='today')await reloadToday()
  }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
async function logout(){
  hasImportantReminders.value=false
  // A browser push endpoint must not keep receiving the old user's private notifications.
  try{
    const registration=await navigator.serviceWorker?.getRegistration()
    const sub=await registration?.pushManager?.getSubscription()
    if(sub){
      try{await api('/push/subscriptions','DELETE',{endpoint:sub.endpoint})}catch{}
      await sub.unsubscribe()
    }
  }catch{}
  try{await api('/auth/logout','POST',{})}catch{}
  clearToast()
  user.value=null;profiles.value=[];tasks.value=[];todayRoutines.value=[];todayPlans.value=[];dismissedTodayKeys.value=[];pendingTasks.value=[];await refresh()
}
function todayTasksUrl(){
 const date=tokyoToday()
 return '/tasks?status=all&today='+date
}
async function loadTasks(){
 const date=tokyoToday()
 const result=await api(todayTasksUrl())
 if(date===tokyoToday()){
   tasks.value=result.tasks||[]
   dismissedTodayKeys.value=result.hiddenTodayKeys||[]
 }
}
async function loadTodayRoutines(){
  if(!user.value)return
  const date=tokyoToday()
  try{
    const result=await api('/routines/today?date='+encodeURIComponent(date))
    // An old response must not replace the list after midnight in Japan.
    if(date===tokyoToday()&&user.value)todayRoutines.value=result.items||[]
  }catch(e){error.value=(e as Error).message}
}
async function loadTodayPlans(){
  if(!user.value)return
  const date=tokyoToday()
  try{
    const result=await api('/plans/today?date='+encodeURIComponent(date))
    if(date===tokyoToday()&&user.value){
      goalReviews.value=(result.goalReviews||[]).filter((x:any)=>x.kind==='goal').map((x:any)=>({
        id:String(x.id),kind:'goal' as const,title:String(x.title),periodKey:String(x.periodKey),
        dueOn:String(x.dueOn),pendingCount:Number(x.pendingCount)||0,
        reviewType:x.reviewType as GoalReview['reviewType'],targetAmount:Number(x.targetAmount)||0
      }))
      todayPlans.value=(result.items||[]).filter(x=>['shopping','wish','goal','trip'].includes(String(x.kind))).
        map((x):TodayPlan=>({
          id:String(x.id),kind:x.kind as PlanKind,title:String(x.title||''),
          dueOn:String(x.dueOn||''),done:!!x.done,overdue:!!x.overdue,
          destination:typeof x.destination==='string'?x.destination:undefined,
          periodKey:typeof x.periodKey==='string'?x.periodKey:undefined,tripEnded:!!x.tripEnded,
          ledgerEntryId:typeof x.ledgerEntryId==='string'?x.ledgerEntryId:null
        }))
    }
  }catch(e){error.value=(e as Error).message}
}
async function reloadToday(){await Promise.all([loadTasks(),loadTodayRoutines(),loadTodayPlans()])}
function editRoutine(r:Routine){
  if(r.created_by!==user.value?.id)return
  editingRoutine.value=editingRoutine.value?.id===r.id?null:r
  editingTask.value=null
}
async function routineSaved(){
  editingRoutine.value=null
  await loadTodayRoutines()
  notify('定期计划已保存')
}
// Today's red action hides only this displayed occurrence, never the source plan.
// One-off overdue tasks may appear again tomorrow; completed marks and pet care stay intact.
async function dismissToday(row:TodayEntry){
  if(!confirm('仅从今天移除这条明细？原计划和完成记录会保留；未完成事项明天可能重新出现。'))return
  try{
    const date=tokyoToday()
    await api('/tasks/today/dismiss','POST',{date,itemKey:row.key})
    if(date===tokyoToday())dismissedTodayKeys.value=[...new Set([...dismissedTodayKeys.value,row.key])]
    notify('已从今天移除，原计划保留')
  }catch(e){error.value=(e as Error).message}
}
async function toggleRoutine(r:Routine){
  if(routineBusy.value)return
  routineBusy.value=true
  try{
    const status=r.mark?.completed_at?'open':'completed'
    await api('/routines/'+r.id+'/mark','POST',{date:tokyoToday(),periodOn:r.occurrenceOn||r.currentPeriodOn,recordOn:r.recordOn||undefined,status})
    await loadTodayRoutines()
    notify(status==='completed'?'定期事项已完成':'已撤销完成')
  }catch(e){error.value=(e as Error).message}
  finally{routineBusy.value=false}
}
function editTask(t:Task){
  if(!user.value||t.creatorUserId!==user.value.id)return
  editingTask.value=editingTask.value?.id===t.id?null:{
    id:t.id,title:t.title,notes:t.notes||'',visibility:t.visibility,dueOn:t.dueOn||'',
    assigneeUserId:t.assigneeUserId,subjectProfileId:t.subjectProfileId||'',
    healthRecordType:t.healthRecordType||'',expectedUpdatedAt:t.updatedAt
  }
}
async function saveTaskEdit(){
  if(!user.value||!editingTask.value)return
  const t=editingTask.value
  if(!t.title.trim()||t.title.length>150){error.value='任务名称必须在 1～150 字符内';return}
  error.value=''
  try{
    const outcome=await sendOrQueueTask(user.value.id,'edit',{
      title:t.title.trim(),notes:t.notes||'',visibility:t.visibility,dueOn:t.dueOn||null,
      assigneeUserId:t.assigneeUserId,subjectProfileId:t.subjectProfileId||null,
      healthRecordType:editTaskPet.value?t.healthRecordType||null:null,
      expectedUpdatedAt:t.expectedUpdatedAt},t.id)
    if(outcome==='queued')syncMessage.value='修改已离线保存，稍后同步'
    else {await loadTasks();notify('修改已保存')}
    editingTask.value=null
    pendingTasks.value=await listPending(user.value.id)
  }catch(e){error.value=(e as Error).message}
}
async function flushTasks(){
  if(!user.value)return
  try{
    const result=await syncPending(user.value.id)
    pendingTasks.value=await listPending(user.value.id)
    if(result.synced){syncMessage.value='';await loadTasks();if(tab.value==='today')notify('已同步 '+result.synced+' 项任务')}
    if(result.conflicts)syncMessage.value='发现 '+result.conflicts+' 项版本冲突，请取消本机草稿并重新编辑'
  }catch(e){syncMessage.value=(e as Error).message}
}
async function discardPending(id:string){
  await removePending(id)
  if(user.value)pendingTasks.value=await listPending(user.value.id)
  if(tab.value==='today')notify('已取消待同步任务')
}
function onOnline(){if(user.value)void flushTasks()}
function onForeground(){
  if(document.visibilityState!=='visible')return
  const d=tokyoToday()
  if(d!==currentJstDay.value){
    currentJstDay.value=d
    if(user.value&&tab.value==='today')void reloadToday()
  }else if(user.value)importantRemindersRef.value?.refreshIfStale()
}
async function toggleTask(t:Task){
  try{
    await api('/tasks/'+t.id,'PATCH',{completed:!t.completedAt});await loadTasks()
    notify(t.completedAt?'已撤销完成':'任务已完成')
  }catch(e){error.value=(e as Error).message}
}
async function addProfile(){
  error.value=''
  try{
    await api('/family/profiles','POST',{displayName:name.value,type:petType.value,
      birthday:birth.value||null,adoptedOn:adopted.value||null})
    await profileSaved()
    closeProfileForm()
  }catch(e){error.value=(e as Error).message}
}
watch(tab,value=>{
  clearToast()
  editingTask.value=null
  editingRoutine.value=null
  if(value==='today'){
    if(!returningToToday){
      todayVisibleCount.value=listPageSize
      pendingVisibleCount.value=listPageSize
      todayCategory.value='all'
      if(user.value)void reloadToday()
    }
  }else if(value==='family'){
    peopleVisibleCount.value=listPageSize
    petsVisibleCount.value=listPageSize
  }
})
onMounted(async()=>{
  try{
    await refresh()
    if(user.value&&tab.value==='today')await reloadToday()
  }finally{authReady.value=true}
  window.addEventListener('online',onOnline)
  document.addEventListener('visibilitychange',onForeground)
  if(user.value&&navigator.onLine)void flushTasks()
})
onBeforeUnmount(()=>{
  window.removeEventListener('online',onOnline)
  document.removeEventListener('visibilitychange',onForeground)
})
</script>

<template>
  <div class="shell">
    <header class="topbar"><div class="brand"><span class="brand-icon"><AppIcon name="house" :size="22" /></span>HomeFlow</div>
      <GlobalSearch v-if="authReady&&user" @select="openSearchResult"/>
      <span v-else class="phase">OUR LITTLE HOME</span></header>
    <main v-if="!authReady" class="auth-content" aria-live="polite">
      <section class="panel" role="status"><h2>正在打开我们的小家…</h2><p class="hint">正在确认登录状态与家庭资料。</p></section>
    </main>
    <main v-else-if="authFailure" class="auth-content">
      <section class="panel"><h2>暂时无法连接 HomeFlow</h2>
        <p role="alert" class="error">{{ authFailure }}</p>
        <p class="hint">会话尚未确认为失效；不会强制显示登录页。</p>
        <button class="primary" type="button" @click="retryAuth">重新连接</button>
      </section>
    </main>
    <main v-else-if="!user" class="auth-content">
      <div class="eyebrow">OUR LITTLE HOME</div><h1>欢迎回家 ♡</h1><p class="lead">家人的共享生活，以及自己的小秘密。</p>
      <form class="panel auth-form" @submit.prevent="submitAuth">
        <h2>{{ authMode==='bootstrap'?'创建我们的家':authMode==='join'?'加入家庭':authMode==='recover'?'恢复账号':'登录 HomeFlow' }}</h2>
        <p v-if="authMode==='bootstrap'&&bootstrapIssue==='missing'" role="alert" class="error">生产 Worker 中尚未找到 HOMEFLOW_BOOTSTRAP_SECRET，请在 Cloudflare 设置至少 32 位的加密 Secret。</p>
        <p v-if="authMode==='bootstrap'&&bootstrapIssue==='too_short'" role="alert" class="error">Cloudflare Secret 已存在，但长度不足 32 字符。请在生产 Worker 的 Variables and Secrets 中更新密钥值。</p>
        <label>登录账号（邮箱或用户名）
          <input v-model.trim="login" required maxlength="254" autocomplete="username" autocapitalize="none"
            spellcheck="false" placeholder="例如 name@example.com"/></label>
        <p class="hint">也可使用 3～36 位英文用户名。邮箱目前仅作为登录账号，不会发送验证邮件。</p>
        <label v-if="authMode==='bootstrap'||authMode==='join'">你的昵称<input v-model="displayName" required maxlength="60" autocomplete="nickname" placeholder="怎么称呼你？"/></label>
        <label>{{ authMode==='recover'?'设置新密码':'密码' }}<input v-model="password" required type="password" minlength="12" maxlength="128"
          :autocomplete="authMode==='recover'?'new-password':'current-password'" placeholder="12～128 位"/></label>
        <label v-if="authMode==='recover'">再次确认新密码
          <input v-model="recoveryConfirm" required type="password" minlength="12" maxlength="128"
            autocomplete="new-password"/></label>
        <label v-if="authMode==='recover'">一次性恢复码
          <input v-model.trim="recoveryCode" required maxlength="32" autocomplete="off" placeholder="32位恢复码"/></label>
        <template v-if="authMode==='bootstrap'">
          <label>家庭名称<input v-model="householdName" maxlength="60" /></label>
          <label>家庭启动密钥<input v-model="bootstrapSecret" type="password" autocomplete="off" required placeholder="Cloudflare Worker Secret"/></label>
        </template>
        <label v-if="authMode==='join'">家庭邀请码<input v-model="invite" required maxlength="64" placeholder="家人提供的一次性代码"/></label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary" :disabled="loading">{{ loading?'正在处理…':authMode==='login'?'登录':authMode==='join'?'加入家庭':authMode==='recover'?'重置密码':'创建家庭' }}</button>
        <div class="auth-links">
          <button type="button" class="text-button" @click="authMode='login';error=''">已有账号？登录</button>
          <button v-if="initialized" type="button" class="text-button" @click="authMode='join';error=''">用邀请码加入</button>
          <button v-if="initialized" type="button" class="text-button" @click="authMode='recover';error=''">忘记密码？使用恢复码</button>
          <button v-else type="button" class="text-button" @click="authMode='bootstrap';error=''">首次初始化</button>
        </div>
      </form>
    </main>
    <main v-else class="content">
      <div class="eyebrow">OUR LITTLE HOME</div>
      <h1>{{ {today:'我们家的今天',plans:'我的计划',memories:'我们的时光轴',family:'家庭档案',manage:'管理中心'}[tab] }} ♡</h1>
      <p class="lead">{{ user.householdName }} · 每件重要的小事</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="tab==='today'">
        <section class="hero"><div><span>HOMEFLOW · TODAY</span><h2>照顾好我们的小家。</h2>
          <p>私人的计划，家庭的约定，豆沙的每一天。</p></div><div class="hero-mark"><AppIcon name="heart" :size="76" /></div></section>
        <section v-if="goalReviews.length" class="panel goal-review-notices" aria-label="储值重要提醒">
          <div class="row-between"><b>重要提醒 · 储值计划</b></div>
          <div v-for="review in goalReviews.slice(0,5)" :key="review.id" class="task-row">
            <AppIcon name="wallet" :size="20"/>
            <div class="task-detail">
              <b>{{ review.title }} · {{ review.pendingCount>1?review.pendingCount+' 期待核验':review.periodKey+(review.pendingCount?' 待核验':' 即将到期') }}</b>
              <small>{{ review.reviewType==='pending'?'已截止，等待账目核验':review.reviewType==='due_today'?'本期今日截止':'即将到期' }}
                · {{ review.dueOn }} · 目标 ¥{{ review.targetAmount.toLocaleString('ja-JP') }}</small>
            </div>
            <button type="button" class="text-button today-plan-link" @click="openPlans('goal',review.id,review.periodKey)">
              {{ review.pendingCount?'去核验':'查看' }}
            </button>
          </div>
          <p v-if="goalReviews.length>5" class="hint">还有 {{ goalReviews.length-5 }} 项储值提醒，可在计划中查看。</p>
        </section>
        <div class="section-title today-task-heading">
          <h2>今日待办</h2>
          <div class="today-task-actions">
            <span>{{ completedTodayCount }} / {{ unifiedToday.length }} 完成</span>
            <button type="button" class="outline today-add-button" @click="openNewTaskInPlans">＋ 新增待办</button>
          </div>
        </div>
        <section class="panel today-checklist-panel">
          <div v-if="pendingTasks.length" class="pending">
            <div class="row-between"><b>待同步的本机任务（{{ pendingTasks.length }}）</b>
              <button type="button" class="text-button" @click="flushTasks">立即同步</button></div>
            <div v-for="op in visiblePendingTasks" :key="op.id" class="task-row">
              <AppIcon name="archive" :size="18" /><div class="task-detail">{{ op.payload.title }}
                <small>{{ op.status==='conflict'?'其他设备已修改，需要重新确认':'待网络恢复后同步' }}</small></div>
              <button class="text-button" @click="discardPending(op.id)">取消</button>
            </div>
            <button v-if="pendingTasks.length>visiblePendingTasks.length" class="outline" type="button"
              @click="pendingVisibleCount+=listPageSize">加载更多待同步任务（每次 5 条）</button>
            <p v-if="syncMessage" class="hint">{{ syncMessage }}</p>
          </div>
          <div class="today-category-tabs" role="group" aria-label="今日待办分类">
            <button v-for="category in visibleTodayCategories" :key="category.id" type="button"
              :class="{selected:todayCategory===category.id}" :aria-pressed="todayCategory===category.id"
              @click="todayCategory=category.id">{{ category.label }}</button>
          </div>

          <div v-if="!unifiedToday.length" class="empty">{{ todayCategory==='all'?'今天没有待处理事项。':'这个分类今天没有事项。' }}</div>
          <template v-for="row in visibleToday" :key="row.key">
            <SwipeActions :id="row.key" scope="today-unified"
              :allow-edit="row.task?.creatorUserId===user.id || row.routine?.created_by===user.id"
              :allow-delete="true" delete-label="从今天移除"
              @edit="row.task?editTask(row.task):row.routine?editRoutine(row.routine):undefined"
              @delete="dismissToday(row)">
              <div class="task-row today-unified-row">
                <input v-if="row.task||row.routine" type="checkbox" :checked="row.done"
                  :disabled="!!row.routine&&routineBusy"
                  :aria-label="(row.done?'撤销完成 ':'完成 ')+row.title"
                  @change="row.task?toggleTask(row.task):row.routine?toggleRoutine(row.routine):undefined"/>
                <AppIcon v-else :name="row.plan?.kind==='shopping'?'shopping':
                  row.plan?.kind==='wish'?'heart':row.plan?.kind==='goal'?'wallet':'plane'" :size="19" />
                <div class="task-detail">
                  <div :class="{done:row.done}">{{ row.title }}</div>
                  <small class="task-meta">
                    <span class="today-kind-label">{{ todayKindLabels[row.kind] }}</span>
                    <template v-if="row.task">
                      <AppIcon :name="row.task.visibility==='private'?'shield':'house'" :size="14" />
                      {{ row.task.visibility==='private'?'仅自己':'家庭共享' }} · {{ row.task.dueOn||'无截止日' }}
                      <template v-if="nameForProfile(row.task.subjectProfileId)"> · {{ nameForProfile(row.task.subjectProfileId) }}</template>
                      <template v-if="row.task.healthRecordType&&isPet(row.task.subjectProfileId)"> · 完成后记护理</template>
                    </template>
                    <template v-else-if="row.routine">
                      {{ row.routine.mark?.completed_at?'本期已完成':row.routine.carriedFrom?'逾期未完成':'今天到期' }} · {{ row.routine.occurrenceOn||tokyoToday() }} · {{ recurringLabel(row.routine) }}
                      <template v-if="nameForProfile(row.routine.subject_profile_id)"> · {{ nameForProfile(row.routine.subject_profile_id) }}</template>
                      <template v-if="row.routine.health_record_type"> · 完成后记护理</template>
                    </template>
                    <template v-else-if="row.plan">
                      {{ row.done?'今天已完成':row.plan.kind==='trip'?(row.plan.tripEnded?'旅行未收尾 · 顺延':'旅行进行中'):
                         row.plan.overdue?'逾期未完成 · 顺延':'今天到期' }} · {{ row.plan.dueOn }}
                      <template v-if="row.plan.kind==='goal'&&row.plan.periodKey&&row.plan.periodKey!=='once'">
                        · {{ row.plan.periodKey }}{{ row.plan.periodKey.length===7?'月':'年' }}目标
                      </template>
                      <template v-if="row.plan.destination"> · {{ row.plan.destination }}</template>
                    </template>
                  </small>
                </div>
                <button v-if="row.plan||row.routine" type="button" class="text-button today-plan-link"
                  :aria-label="'前往'+todayKindLabels[row.kind]+'计划处理：'+row.title"
                  @click="row.routine?openPlans('routine',row.routine.id,row.routine.occurrenceOn||'',row.done):row.plan&&openPlans(row.plan.kind,row.plan.id,row.plan.periodKey||'',row.done)">
                  {{ row.done?'查看计划':'去处理' }}</button>
              </div>
            </SwipeActions>
            <form v-if="row.task&&editingTask?.id===row.task.id" class="task-edit-form" @submit.prevent="saveTaskEdit">
              <b>编辑任务</b>
              <label>名称<input v-model="editingTask.title" required maxlength="150"/></label>
              <label>可见范围<select v-model="editingTask.visibility">
                <option value="private">仅自己</option><option value="household">家庭共享</option>
              </select></label>
              <label>截止日期<DateField v-model="editingTask.dueOn" /></label>
              <label>关联对象（可选）
                <select v-model="editingTask.subjectProfileId" @change="changedEditingSubject">
                  <option value="">不关联任何人或宠物</option>
                  <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.displayName }}（{{ p.type==='pet'?'宠物':'家人' }}）</option>
                </select>
              </label>
              <label v-if="editTaskPet">完成后同步到宠物护理记录
                <select v-model="editingTask.healthRecordType">
                  <option value="">不自动记录</option><option value="other">日常护理</option>
                  <option value="grooming">梳毛／洗澡</option><option value="medication">用药</option>
                  <option value="deworm">驱虫</option><option value="vaccination">疫苗</option><option value="vet">就诊</option>
                </select>
              </label>
              <div class="task-edit-actions">
                <button type="button" class="outline" @click="editingTask=null">取消</button>
                <button class="primary">保存修改</button>
              </div>
            </form>
            <LifeItemEditor v-if="row.routine&&editingRoutine?.id===row.routine.id"
              kind="routines" :item="row.routine" :profiles="profiles"
              @saved="routineSaved" @cancel="editingRoutine=null"/>
          </template>
          <button v-if="unifiedToday.length>visibleToday.length" type="button" class="outline"
            @click="todayVisibleCount+=listPageSize">加载更多今日待办（每次 5 条）</button>
        </section>
      </template>
      <template v-else-if="tab==='family'">
        <section class="panel">
          <div class="family-section-heading">
            <h2><AppIcon name="users" :size="20" /> 家庭成员</h2>
            <span class="section-hint">{{ people.length }} 位成员</span>
          </div>

          <div v-if="people.length" class="profiles">
            <div v-for="p in visiblePeople" :key="p.id" :id="'profile-'+p.id" class="profile-entry">
              <button v-if="canEditProfile(p)" type="button" class="profile profile-button"
                :aria-expanded="editProfileId===p.id" @click="toggleProfileEdit(p.id)">
                <span class="profile-symbol"><AppIcon name="users" :size="22" /></span>
                <span class="profile-description"><b>{{ p.displayName }}</b>
                  <small>{{ p.relation||'家庭成员' }} · {{ p.birthday||'未填写生日' }}</small>
                </span>
                <span class="profile-edit-action">{{ editProfileId===p.id?'收起':'编辑' }}</span>
              </button>
              <div v-else class="profile">
                <span class="profile-symbol"><AppIcon name="users" :size="22" /></span>
                <div class="profile-description"><b>{{ p.displayName }}</b>
                  <p>{{ p.relation||'家庭成员' }} · {{ p.birthday||'未填写生日' }}</p>
                </div>
              </div>
              <ProfileEditor v-if="editProfileId===p.id&&canEditProfile(p)" :key="p.id"
                :profile="p" @saved="profileSaved" @close="editProfileId=null"/>
            </div>
          </div>
          <button v-if="people.length>visiblePeople.length" class="outline" type="button"
            @click="peopleVisibleCount+=listPageSize">加载更多家庭成员（每次 5 条）</button>
          <p v-if="!people.length" class="empty">还没有家庭成员档案</p>
        </section>
        <section class="panel">
          <div class="family-section-heading">
            <h2><AppIcon name="paw" :size="20" /> 宠物档案</h2>
            <span class="section-hint">{{ pets.length }} 只宠物</span>
          </div>
          <p class="hint">点击宠物卡片，查看体重、驱虫、疫苗和护理记录。</p>
          <div v-for="p in visiblePets" :key="p.id" :id="'profile-'+p.id" class="pet-profile-entry">
            <button type="button" class="pet-profile-trigger" :aria-expanded="openPetId===p.id"
              :aria-controls="'pet-health-'+p.id" @click="togglePet(p.id)">
              <span class="profile-symbol"><AppIcon name="paw" :size="22" /></span>
              <span class="profile-description"><b>{{ p.displayName }}</b>
                <small>生日：{{ p.birthday||'未填写' }} · 到家日：{{ p.adoptedOn||'未填写' }}</small>
              </span>
              <AppIcon class="pet-chevron" name="chevron-down" :size="20" />
            </button>
            <div v-if="openPetId===p.id" :id="'pet-health-'+p.id" class="pet-health-content">
              <button v-if="canEditProfile(p)" type="button" class="outline profile-pet-edit"
                @click="toggleProfileEdit(p.id)">
                {{ editProfileId===p.id?'收起编辑':'编辑豆沙／宠物档案' }}
              </button>
              <ProfileEditor v-if="editProfileId===p.id&&canEditProfile(p)" :key="p.id"
                :profile="p" @saved="profileSaved" @close="editProfileId=null"/>
              <PetHealthPanel :pet-id="p.id" :name="p.displayName" :user-id="user.id" />
            </div>
          </div>
          <button v-if="pets.length>visiblePets.length" class="outline" type="button"
            @click="petsVisibleCount+=listPageSize">加载更多宠物档案（每次 5 条）</button>
          <p v-if="!pets.length" class="empty">尚无宠物档案，可以在下方添加豆沙。</p>
        </section>
        <section v-if="user.role==='owner'" class="panel">
          <button type="button" class="outline" :aria-expanded="showProfileForm"
            aria-controls="new-family-profile-form" @click="toggleProfileForm">
            {{ showProfileForm?'收起表单':'＋ 添加家庭或宠物档案' }}
          </button>
          <form v-if="showProfileForm" id="new-family-profile-form" class="profile-form"
            @submit.prevent="addProfile">
            <label class="field-wide">昵称或名字
              <input v-model="name" required maxlength="60" placeholder="例如：豆沙" />
            </label>
            <label>类型
              <select v-model="petType"><option value="person">家庭成员</option><option value="pet">宠物</option></select>
            </label>
            <label>生日（可选）
              <DateField v-model="birth" />
            </label>
            <label v-if="petType==='pet'">到家日（可选）
              <DateField v-model="adopted" />
            </label>
            <div class="field-wide profile-form-actions">
              <button type="button" class="outline" @click="closeProfileForm">取消</button>
              <button type="submit" class="primary">添加档案</button>
            </div>
          </form>
        </section>
      </template>
      <section v-else-if="tab==='plans'||tab==='memories'" class="hero"><div><span>HOMEFLOW LIFE</span>
        <h2 class="hero-title"><AppIcon :name="tab==='plans'?'plane':'heart'" :size="22" /> {{ tab==='plans'?'把想做的事安排好':'把值得纪念的时刻留下来' }}</h2>
        <p>心愿、旅行和家庭回忆，现在可以开始记录。</p></div></section>
      <LifePanel v-if="tab==='today'||tab==='family'||tab==='plans'||tab==='memories'" :key="user.id+':'+tab" :mode="tab" :user-id="user.id" :profiles="profiles" :is-owner="user.role==='owner'"
         :tasks="tasks" :focus-plan-type="focusPlanType" :focus-plan-id="focusPlanId"
        :focus-plan-period-key="focusPlanPeriodKey" :focus-plan-scope="focusPlanScope"
         :focus-plan-from-today="focusPlanFromToday"
        :focus-plan-request="focusPlanRequest" :open-plan-creator="openPlanCreatorOnNavigate" :profile-revision="profileRevision"
        @edit-profile="openBirthdayProfileEditor" @tasks-changed="loadTasks"
        @open-plans="openPlans" @back-to-today="returnToToday" />
      <ManagePage v-show="tab==='manage'" ref="importantRemindersRef" :active="tab==='manage'"
        :user-id="user.id" :login-name="user.loginName" :is-owner="user.role==='owner'"
        :today-date="currentJstDay" :today-entry-keys="todayEntryKeys"
        @presence-change="hasImportantReminders=$event" @logout="logout" />
    </main>
    <PageToast :toast="toast" />
    <nav v-if="authReady&&user" class="nav" aria-label="页面导航">
      <button v-for="n in nav" :key="n.id" :class="['nav-item',{selected:tab===n.id}]" @click="navigateTab(n.id)">
        <AppIcon :name="n.icon" :size="23" />
        <span v-if="n.id==='manage'&&(hasImportantReminders||goalReviews.length)"
          class="nav-alert-dot" aria-hidden="true"></span>
        <span>{{ n.label }}</span></button>
    </nav>
  </div>
</template>
