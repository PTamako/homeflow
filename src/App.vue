<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,nextTick,ref,watch} from 'vue'
import {listPending,sendOrQueueTask,syncPending,removePending,type PendingTaskOp} from './offline-tasks'
import BackupPanel from './components/BackupPanel.vue'
import {validLocalPassword,registerPassword,loginPassword} from './auth-crypto'
import LifePanel from './components/LifePanel.vue'
import PushPanel from './components/PushPanel.vue'
import PetHealthPanel from './components/PetHealthPanel.vue'
import ProfileEditor from './components/ProfileEditor.vue'
import AppIcon from './components/AppIcon.vue'
import SwipeActions from './components/SwipeActions.vue'
import PageToast from './components/PageToast.vue'
import {usePageToast} from './page-toast'
type User={id:string;loginName:string;role:'owner'|'member';householdId:string;householdName:string}
type Profile={id:string;memberUserId:string|null;type:'person'|'pet';displayName:string;birthday:string|null;relation:string;adoptedOn:string|null;weightGrams:number|null;notes:string}
type Task={id:string;title:string;notes:string;visibility:'private'|'household';dueOn:string|null;creatorUserId:string;subjectProfileId:string|null;assigneeUserId:string|null;healthRecordType:string|null;completedAt:string|null;updatedAt:string}
type Data={ok?:boolean;error?:string;initialized?:boolean;bootstrapAvailable?:boolean;bootstrapIssue?:'missing'|'too_short'|null;user?:User;profiles?:Profile[];tasks?:Task[];invitationCode?:string}
const user=ref<User|null>(null),profiles=ref<Profile[]>([]),tasks=ref<Task[]>([])
const tab=ref<'today'|'family'|'plans'|'memories'>('today')
const focusPlanType=ref('all')
function openPlans(kind:string){focusPlanType.value=kind;tab.value='plans'}
const authMode=ref<'login'|'bootstrap'|'join'>('login'),initialized=ref(true),loading=ref(false)
const bootstrapIssue=ref<'missing'|'too_short'|null>(null)
const login=ref(''),password=ref(''),displayName=ref(''),householdName=ref('我们的小家'),bootstrapSecret=ref(''),invite=ref('')
const title=ref(''),visibility=ref<'private'|'household'>('private'),due=ref(''),subjectId=ref(''),taskCareType=ref('')
const editingTask=ref<{id:string;title:string;notes:string;visibility:'private'|'household';dueOn:string;
  assigneeUserId:string|null;subjectProfileId:string;healthRecordType:string;expectedUpdatedAt:string}|null>(null)
const name=ref(''),petType=ref<'pet'|'person'>('pet'),birth=ref(''),adopted=ref('')
const error=ref(''),invitation=ref(''),showDone=ref(false)
const {toast,notify,clear:clearToast}=usePageToast()
const pendingTasks=ref<PendingTaskOp[]>([]),syncMessage=ref('')
const openPetId=ref<string|null>(null)
const editProfileId=ref<string|null>(null),profileRevision=ref(0)
const nav=[{id:'today',icon:'sun',label:'今天'},{id:'plans',icon:'clipboard-check',label:'计划'},{id:'memories',icon:'images',label:'时光轴'},{id:'family',icon:'house',label:'家庭'}] as const
function tokyoToday(){return new Date(Date.now()+9*3600000).toISOString().slice(0,10)}
function tokyoDate(timestamp:string){
 const iso=timestamp.includes('T')?timestamp:timestamp.replace(' ','T')+'Z'
 const n=Date.parse(iso)
 return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,10):''
}
const currentJstDay=ref(tokyoToday())
const visibleTasks=computed(()=>tasks.value.filter(t=>{
 const now=currentJstDay.value
 return t.completedAt?showDone.value||tokyoDate(t.completedAt)===now:
   !t.dueOn||t.dueOn<=now
}))
const pets=computed(()=>profiles.value.filter(p=>p.type==='pet'))
const isPet=(id:string|null|undefined)=>profiles.value.some(p=>p.id===id&&p.type==='pet')
const nameForProfile=(id:string|null|undefined)=>profiles.value.find(p=>p.id===id)?.displayName||''
const newTaskPet=computed(()=>isPet(subjectId.value))
const editTaskPet=computed(()=>isPet(editingTask.value?.subjectProfileId))
watch(subjectId,id=>{taskCareType.value=isPet(id)?'other':''})
function changedEditingSubject(){
 if(editingTask.value)editingTask.value.healthRecordType=isPet(editingTask.value.subjectProfileId)?'other':''
}
const people=computed(()=>profiles.value.filter(p=>p.type==='person'))
function togglePet(id:string){openPetId.value=openPetId.value===id?null:id}
function canEditProfile(p:Profile){return user.value?.role==='owner'||p.memberUserId===user.value?.id}
function toggleProfileEdit(id:string){editProfileId.value=editProfileId.value===id?null:id}
async function openBirthdayProfileEditor(id:string){
  const profile=profiles.value.find(p=>p.id===id)
  if(!profile||!canEditProfile(profile))return
  tab.value='family'
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
  try{
    user.value=(await api('/auth/me')).user||null
    if(user.value){
      const [a,b]=await Promise.all([api('/family'),api('/tasks?status=all')])
      profiles.value=a.profiles||[];tasks.value=b.tasks||[]
      try{pendingTasks.value=await listPending(user.value.id)}catch{pendingTasks.value=[]}
    }
  }catch{
    user.value=null;pendingTasks.value=[]
    try{
      const status=await api('/auth/bootstrap-status')
      initialized.value=!!status.initialized
      bootstrapIssue.value=status.bootstrapIssue||null
      if(!status.initialized)authMode.value='bootstrap'
    }catch{}
  }
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
    } else {
      const proof=await loginPassword(login.value,password.value)
      await api('/auth/login','POST',{loginName:login.value,...proof})
    }
    password.value='';bootstrapSecret.value='';invite.value=''
    await refresh()
  }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
async function logout(){
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
  user.value=null;profiles.value=[];tasks.value=[];pendingTasks.value=[];await refresh()
}
async function loadTasks(){tasks.value=(await api('/tasks?status=all')).tasks||[]}
async function addTask(){
  if(!title.value.trim()||!user.value)return
  error.value='';loading.value=true;syncMessage.value=''
  try{
    const outcome=await sendOrQueueTask(user.value.id,'create',{title:title.value,notes:'',
      visibility:visibility.value,dueOn:due.value||null,subjectProfileId:subjectId.value||null,
      healthRecordType:newTaskPet.value?taskCareType.value||null:null})
    title.value='';due.value='';subjectId.value='';taskCareType.value=''
    if(outcome==='queued')syncMessage.value='离线保存到本机，联网后可同步'
    else {await loadTasks();notify('任务已添加')}
    pendingTasks.value=await listPending(user.value.id)
  }catch(e){error.value=(e as Error).message}finally{loading.value=false}
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
    if(user.value&&tab.value==='today')void loadTasks()
  }
}
async function toggleTask(t:Task){
  try{
    await api('/tasks/'+t.id,'PATCH',{completed:!t.completedAt});await loadTasks()
    notify(t.completedAt?'已撤销完成':'任务已完成')
  }catch(e){error.value=(e as Error).message}
}
async function deleteTask(t:Task){
  if(!confirm('删除这条任务？'))return
  try{await api('/tasks/'+t.id,'DELETE');await loadTasks();notify('任务已删除')}
  catch(e){error.value=(e as Error).message}
}
async function addProfile(){
  error.value=''
  try{
    await api('/family/profiles','POST',{displayName:name.value,type:petType.value,
      birthday:birth.value||null,adoptedOn:adopted.value||null})
    await profileSaved()
    name.value='';birth.value='';adopted.value=''
  }catch(e){error.value=(e as Error).message}
}
async function generateInvite(){
  error.value=''
  try{invitation.value=(await api('/auth/invitations','POST',{})).invitationCode||'';notify('邀请码已生成')}
  catch(e){error.value=(e as Error).message}
}
watch(tab,value=>{clearToast();if(value==='today'&&user.value)loadTasks()})
onMounted(async()=>{
  await refresh()
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
      <button v-if="user" class="text-button" @click="logout">退出 · {{ user.loginName }}</button>
      <span v-else class="phase">OUR LITTLE HOME</span></header>
    <main v-if="!user" class="auth-content">
      <div class="eyebrow">OUR LITTLE HOME</div><h1>欢迎回家 ♡</h1><p class="lead">家人的共享生活，以及自己的小秘密。</p>
      <form class="panel auth-form" @submit.prevent="submitAuth">
        <h2>{{ authMode==='bootstrap'?'创建我们的家':authMode==='join'?'加入家庭':'登录 HomeFlow' }}</h2>
        <p v-if="authMode==='bootstrap'&&bootstrapIssue==='missing'" role="alert" class="error">生产 Worker 中尚未找到 HOMEFLOW_BOOTSTRAP_SECRET，请在 Cloudflare 设置至少 32 位的加密 Secret。</p>
        <p v-if="authMode==='bootstrap'&&bootstrapIssue==='too_short'" role="alert" class="error">Cloudflare Secret 已存在，但长度不足 32 字符。请在生产 Worker 的 Variables and Secrets 中更新密钥值。</p>
        <label>登录账号（邮箱或用户名）
          <input v-model.trim="login" required maxlength="254" autocomplete="username" autocapitalize="none"
            spellcheck="false" placeholder="例如 name@example.com"/></label>
        <p class="hint">也可使用 3～36 位英文用户名。邮箱目前仅作为登录账号，不会发送验证邮件。</p>
        <label v-if="authMode!=='login'">你的昵称<input v-model="displayName" required maxlength="60" autocomplete="nickname" placeholder="怎么称呼你？"/></label>
        <label>密码<input v-model="password" required type="password" minlength="12" maxlength="128" autocomplete="current-password" placeholder="12～128 位"/></label>
        <template v-if="authMode==='bootstrap'">
          <label>家庭名称<input v-model="householdName" maxlength="60" /></label>
          <label>家庭启动密钥<input v-model="bootstrapSecret" type="password" autocomplete="off" required placeholder="Cloudflare Worker Secret"/></label>
        </template>
        <label v-if="authMode==='join'">家庭邀请码<input v-model="invite" required maxlength="64" placeholder="家人提供的一次性代码"/></label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary" :disabled="loading">{{ loading?'正在处理…':authMode==='login'?'登录':authMode==='join'?'加入家庭':'创建家庭' }}</button>
        <div class="auth-links">
          <button type="button" class="text-button" @click="authMode='login';error=''">已有账号？登录</button>
          <button v-if="initialized" type="button" class="text-button" @click="authMode='join';error=''">用邀请码加入</button>
          <button v-else type="button" class="text-button" @click="authMode='bootstrap';error=''">首次初始化</button>
        </div>
      </form>
    </main>
    <main v-else class="content">
      <div class="eyebrow">OUR LITTLE HOME</div>
      <h1>{{ {today:'我们家的今天',plans:'我的计划',memories:'我们的时光轴',family:'家庭档案'}[tab] }} ♡</h1>
      <p class="lead">{{ user.householdName }} · 每件重要的小事</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="tab==='today'">
        <section class="hero"><div><span>HOMEFLOW · TODAY</span><h2>照顾好我们的小家。</h2>
          <p>私人的计划，家庭的约定，豆沙的每一天。</p></div><div class="hero-mark"><AppIcon name="heart" :size="76" /></div></section>
        <div class="section-title"><h2>今日与近期待办</h2><span>{{ visibleTasks.filter(t=>!!t.completedAt).length }} / {{ visibleTasks.length }} 今日事项</span></div>
        <section class="panel">
          <form class="task-form" @submit.prevent="addTask">
            <input v-model="title" required maxlength="150" placeholder="新增一件待办……" aria-label="任务标题"/>
            <select v-model="visibility" aria-label="可见范围"><option value="private">仅自己</option><option value="household">家庭共享</option></select>
            <input v-model="due" type="date" aria-label="完成日期"/>
            <label class="task-object">关联对象（可选）
              <select v-model="subjectId" aria-label="这项任务与谁有关"><option value="">不关联任何人或宠物</option>
                <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.displayName }}（{{ p.type==='pet'?'宠物':'家人' }}）</option>
              </select></label>
            <label v-if="newTaskPet" class="task-object">完成后同步到宠物护理记录
              <select v-model="taskCareType" aria-label="普通任务完成时护理记录类型">
                <option value="">不自动记录</option><option value="other">日常护理（默认）</option>
                <option value="grooming">梳毛／洗澡</option><option value="medication">用药</option>
                <option value="deworm">驱虫</option><option value="vaccination">疫苗</option><option value="vet">就诊</option>
              </select>
            </label>
            <p class="task-object-hint">关联豆沙等宠物后，默认勾选完成就记录护理历史；也可以关闭。不会改变家庭共享权限。</p>
            <button class="primary" :disabled="loading">＋ 添加任务</button>
          </form>
          <div v-if="pendingTasks.length" class="pending">
            <div class="row-between"><b>待同步的本机任务（{{ pendingTasks.length }}）</b>
              <button type="button" class="text-button" @click="flushTasks">立即同步</button></div>
            <div v-for="op in pendingTasks" :key="op.id" class="task-row">
              <AppIcon name="archive" :size="18" /><div class="task-detail">{{ op.payload.title }}
                <small>{{ op.status==='conflict'?'其他设备已修改，需要重新确认':'待网络恢复后同步' }}</small></div>
              <button class="text-button" @click="discardPending(op.id)">取消</button>
            </div>
            <p v-if="syncMessage" class="hint">{{ syncMessage }}</p>
          </div>
          <div class="row-between"><b>今日待办</b><label class="inline"><input v-model="showDone" type="checkbox"/> 显示历史完成</label></div>
          <div v-if="!visibleTasks.length" class="empty">今天没有任务，添加一件小事吧。</div>
          <template v-for="t in visibleTasks" :key="t.id">
          <SwipeActions :id="t.id" scope="today-tasks"
            :allow-edit="t.creatorUserId===user.id" :allow-delete="t.creatorUserId===user.id"
            @edit="editTask(t)" @delete="deleteTask(t)">
            <div class="task-row">
              <input type="checkbox" :checked="!!t.completedAt" :aria-label="'完成 '+t.title" @change="toggleTask(t)"/>
              <div class="task-detail"><div :class="{done:!!t.completedAt}">{{ t.title }}</div>
                <small class="task-meta"><AppIcon :name="t.visibility==='private'?'shield':'house'" :size="14" />
                  {{ t.visibility==='private'?'仅自己':'家庭共享' }} · {{ t.dueOn||'无截止日' }}
                  <template v-if="nameForProfile(t.subjectProfileId)"> · {{ nameForProfile(t.subjectProfileId) }}</template>
                  <template v-if="t.healthRecordType&&isPet(t.subjectProfileId)"> · 完成后记护理</template>
                </small></div>
            </div>
          </SwipeActions>
          <form v-if="editingTask?.id===t.id" class="task-edit-form" @submit.prevent="saveTaskEdit">
            <b>编辑任务</b>
            <label>名称<input v-model="editingTask.title" required maxlength="150"/></label>
            <label>可见范围<select v-model="editingTask.visibility">
              <option value="private">仅自己</option><option value="household">家庭共享</option>
            </select></label>
            <label>截止日期<input v-model="editingTask.dueOn" type="date"/></label>
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
          </template>
        </section>
      </template>
      <template v-else-if="tab==='family'">
        <section class="panel">
          <div class="family-section-heading">
            <h2><AppIcon name="users" :size="20" /> 家庭成员</h2>
            <span class="section-hint">{{ people.length }} 位成员</span>
          </div>
          <p class="hint">点击自己的档案即可补充或修改生日。填写后自动加入每年生日提醒。</p>
          <div v-if="people.length" class="profiles">
            <div v-for="p in people" :key="p.id" :id="'profile-'+p.id" class="profile-entry">
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
          <p v-else class="empty">还没有家庭成员档案</p>
        </section>
        <section class="panel">
          <div class="family-section-heading">
            <h2><AppIcon name="paw" :size="20" /> 宠物档案</h2>
            <span class="section-hint">{{ pets.length }} 只宠物</span>
          </div>
          <p class="hint">点击宠物卡片，查看体重、驱虫、疫苗和护理记录。</p>
          <div v-for="p in pets" :key="p.id" :id="'profile-'+p.id" class="pet-profile-entry">
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
          <p v-if="!pets.length" class="empty">尚无宠物档案，可以在下方添加豆沙。</p>
        </section>
        <section v-if="user.role==='owner'" class="panel">
          <h2>添加家庭或宠物档案</h2>
          <form class="profile-form" @submit.prevent="addProfile">
            <label class="field-wide">昵称或名字
              <input v-model="name" required maxlength="60" placeholder="例如：豆沙" />
            </label>
            <label>类型
              <select v-model="petType"><option value="person">家庭成员</option><option value="pet">宠物</option></select>
            </label>
            <label>生日（可选）
              <input v-model="birth" type="date" />
            </label>
            <label v-if="petType==='pet'">到家日（可选）
              <input v-model="adopted" type="date" />
            </label>
            <button class="primary field-wide">添加档案</button>
          </form>
        </section>
        <section v-if="user.role==='owner'" class="panel">
          <h2>邀请家人独立登录</h2>
          <p class="hint">邀请码 7 天内有效，每个家庭最多两位登录成员。</p>
          <button class="outline" @click="generateInvite">生成邀请码</button>
          <div v-if="invitation" class="invitation"><code>{{ invitation }}</code><p>仅发送给家人，请勿公开。</p></div>
        </section>
      </template>
      <section v-else class="hero"><div><span>HOMEFLOW LIFE</span>
        <h2 class="hero-title"><AppIcon :name="tab==='plans'?'plane':'heart'" :size="22" /> {{ tab==='plans'?'把想做的事安排好':'把值得纪念的时刻留下来' }}</h2>
        <p>心愿、旅行和家庭回忆，现在可以开始记录。</p></div></section>
      <PushPanel v-if="tab==='today'" />
      <LifePanel :mode="tab" :user-id="user.id" :profiles="profiles" :is-owner="user.role==='owner'"
        :tasks="tasks" :focus-plan-type="focusPlanType" :profile-revision="profileRevision"
        @edit-profile="openBirthdayProfileEditor" @tasks-changed="loadTasks" @open-plans="openPlans" />
      <BackupPanel v-if="tab==='family'" :user-id="user.id" />
    </main>
    <PageToast :toast="toast" />
    <nav v-if="user" class="nav" aria-label="页面导航">
      <button v-for="n in nav" :key="n.id" :class="['nav-item',{selected:tab===n.id}]" @click="tab=n.id">
        <AppIcon :name="n.icon" :size="23" /><span>{{ n.label }}</span></button>
    </nav>
  </div>
</template>
