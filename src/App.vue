<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue'
import {listPending,sendOrQueueTask,syncPending,removePending,type PendingTaskOp} from './offline-tasks'
import BackupPanel from './components/BackupPanel.vue'
import LifePanel from './components/LifePanel.vue'
import PushPanel from './components/PushPanel.vue'
import PetHealthPanel from './components/PetHealthPanel.vue'
type User={id:string;loginName:string;role:'owner'|'member';householdId:string;householdName:string}
type Profile={id:string;memberUserId:string|null;type:'person'|'pet';displayName:string;birthday:string|null;relation:string;adoptedOn:string|null;weightGrams:number|null;notes:string}
type Task={id:string;title:string;notes:string;visibility:'private'|'household';dueOn:string|null;creatorUserId:string;subjectProfileId:string|null;assigneeUserId:string|null;completedAt:string|null;updatedAt:string}
type Data={ok?:boolean;error?:string;initialized?:boolean;bootstrapAvailable?:boolean;bootstrapIssue?:'missing'|'too_short'|null;user?:User;profiles?:Profile[];tasks?:Task[];invitationCode?:string}
const user=ref<User|null>(null),profiles=ref<Profile[]>([]),tasks=ref<Task[]>([])
const tab=ref<'today'|'cat'|'family'|'plans'|'memories'>('today')
const authMode=ref<'login'|'bootstrap'|'join'>('login'),initialized=ref(true),loading=ref(false)
const bootstrapIssue=ref<'missing'|'too_short'|null>(null)
const login=ref(''),password=ref(''),displayName=ref(''),householdName=ref('我们的小家'),bootstrapSecret=ref(''),invite=ref('')
const title=ref(''),visibility=ref<'private'|'household'>('private'),due=ref(''),subjectId=ref('')
const name=ref(''),petType=ref<'pet'|'person'>('pet'),birth=ref(''),adopted=ref('')
const error=ref(''),invitation=ref(''),showDone=ref(false)
const pendingTasks=ref<PendingTaskOp[]>([]),syncMessage=ref('')
const nav=[{id:'today',icon:'☀',label:'今天'},{id:'plans',icon:'✓',label:'计划'},{id:'memories',icon:'▧',label:'时光轴'},{id:'cat',icon:'🐾',label:'豆沙'},{id:'family',icon:'⌂',label:'家庭'}] as const
const visibleTasks=computed(()=>tasks.value.filter(t=>showDone.value||!t.completedAt))
const pets=computed(()=>profiles.value.filter(p=>p.type==='pet'))
const errText=(key:string)=>{
  const map:Record<string,string>={invalid_credentials:'账号或密码错误',invalid_input:'输入格式不符合要求，请检查所有字段。',
    invalid_login_name:'登录账号格式不正确：请使用邮箱地址，或 3～36 位英文用户名（可包含数字、点、下划线和连字符）。',
    invalid_password:'密码需为 12～128 个字符，UTF-8 编码不超过 300 字节。',
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
    const details={loginName:login.value,password:password.value,displayName:displayName.value}
    if(authMode.value==='bootstrap')await api('/auth/bootstrap','POST',{...details,householdName:householdName.value,bootstrapSecret:bootstrapSecret.value})
    else if(authMode.value==='join')await api('/auth/join','POST',{...details,invitationCode:invite.value})
    else await api('/auth/login','POST',details)
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
  user.value=null;profiles.value=[];tasks.value=[];pendingTasks.value=[];await refresh()
}
async function loadTasks(){tasks.value=(await api('/tasks?status=all')).tasks||[]}
async function addTask(){
  if(!title.value.trim()||!user.value)return
  error.value='';loading.value=true;syncMessage.value=''
  try{
    const outcome=await sendOrQueueTask(user.value.id,'create',{title:title.value,notes:'',
      visibility:visibility.value,dueOn:due.value||null,subjectProfileId:subjectId.value||null})
    title.value='';due.value='';subjectId.value=''
    if(outcome==='queued')syncMessage.value='离线保存到本机，联网后可同步'
    else await loadTasks()
    pendingTasks.value=await listPending(user.value.id)
  }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
async function editTask(t:Task){
  if(!user.value||t.creatorUserId!==user.value.id)return
  const name=prompt('修改任务内容',t.title)
  if(name===null)return
  const newTitle=name.trim()
  if(!newTitle||newTitle.length>150){error.value='任务名称必须在 1～150 字符内';return}
  error.value=''
  try{
    const outcome=await sendOrQueueTask(user.value.id,'edit',{
      title:newTitle,notes:t.notes||'',visibility:t.visibility,dueOn:t.dueOn,
      assigneeUserId:t.assigneeUserId,subjectProfileId:t.subjectProfileId,
      expectedUpdatedAt:t.updatedAt},t.id)
    if(outcome==='queued')syncMessage.value='修改已离线保存，稍后同步'
    else await loadTasks()
    pendingTasks.value=await listPending(user.value.id)
  }catch(e){error.value=(e as Error).message}
}
async function flushTasks(){
  if(!user.value)return
  try{
    const result=await syncPending(user.value.id)
    pendingTasks.value=await listPending(user.value.id)
    if(result.synced){syncMessage.value='已同步 '+result.synced+' 项任务';await loadTasks()}
    if(result.conflicts)syncMessage.value='发现 '+result.conflicts+' 项版本冲突，请取消本机草稿并重新编辑'
  }catch(e){syncMessage.value=(e as Error).message}
}
async function discardPending(id:string){
  await removePending(id)
  if(user.value)pendingTasks.value=await listPending(user.value.id)
}
function onOnline(){if(user.value)void flushTasks()}
async function toggleTask(t:Task){
  try{
    await api('/tasks/'+t.id,'PATCH',{completed:!t.completedAt});await loadTasks()
  }catch(e){error.value=(e as Error).message}
}
async function deleteTask(t:Task){
  if(!confirm('删除这条任务？'))return
  try{await api('/tasks/'+t.id,'DELETE');await loadTasks()}
  catch(e){error.value=(e as Error).message}
}
async function addProfile(){
  error.value=''
  try{
    await api('/family/profiles','POST',{displayName:name.value,type:petType.value,
      birthday:birth.value||null,adoptedOn:adopted.value||null})
    profiles.value=(await api('/family')).profiles||[]
    name.value='';birth.value='';adopted.value=''
  }catch(e){error.value=(e as Error).message}
}
async function generateInvite(){
  error.value=''
  try{invitation.value=(await api('/auth/invitations','POST',{})).invitationCode||''}
  catch(e){error.value=(e as Error).message}
}
watch(tab,value=>{if(value==='today'&&user.value)loadTasks()})
onMounted(async()=>{await refresh();window.addEventListener('online',onOnline);if(user.value&&navigator.onLine)void flushTasks()})
onBeforeUnmount(()=>window.removeEventListener('online',onOnline))
</script>

<template>
  <div class="shell">
    <header class="topbar"><div class="brand"><span class="brand-icon">⌂</span>HomeFlow</div>
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
      <h1>{{ {today:'我们家的今天',plans:'旅行与心愿',memories:'我们的时光轴',cat:'豆沙的小天地',family:'家庭档案'}[tab] }} ♡</h1>
      <p class="lead">{{ user.householdName }} · 每件重要的小事</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="tab==='today'">
        <section class="hero"><div><span>HOMEFLOW · TODAY</span><h2>照顾好我们的小家。</h2>
          <p>私人的计划，家庭的约定，豆沙的每一天。</p></div><div class="hero-mark">✿</div></section>
        <div class="section-title"><h2>今日与近期待办</h2><span>{{ tasks.filter(t=>!!t.completedAt).length }} / {{ tasks.length }} 完成</span></div>
        <section class="panel">
          <form class="task-form" @submit.prevent="addTask">
            <input v-model="title" required maxlength="150" placeholder="新增一件待办……" aria-label="任务标题"/>
            <select v-model="visibility" aria-label="可见范围"><option value="private">🔒 个人</option><option value="household">⌂ 家庭共享</option></select>
            <input v-model="due" type="date" aria-label="完成日期"/>
            <select v-model="subjectId" aria-label="关联对象"><option value="">不关联成员</option>
              <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.displayName }}</option></select>
            <button class="primary" :disabled="loading">＋ 添加任务</button>
          </form>
          <div v-if="pendingTasks.length" class="pending">
            <div class="row-between"><b>待同步的本机任务（{{ pendingTasks.length }}）</b>
              <button type="button" class="text-button" @click="flushTasks">立即同步</button></div>
            <div v-for="op in pendingTasks" :key="op.id" class="task-row">
              <span>☁</span><div class="task-detail">{{ op.payload.title }}
                <small>{{ op.status==='conflict'?'其他设备已修改，需要重新确认':'待网络恢复后同步' }}</small></div>
              <button class="text-button" @click="discardPending(op.id)">取消</button>
            </div>
            <p v-if="syncMessage" class="hint">{{ syncMessage }}</p>
          </div>
          <div class="row-between"><b>任务列表</b><label class="inline"><input v-model="showDone" type="checkbox"/> 显示已完成</label></div>
          <div v-if="!visibleTasks.length" class="empty">今天没有任务，添加一件小事吧。</div>
          <div v-for="t in visibleTasks" :key="t.id" class="task-row">
            <input type="checkbox" :checked="!!t.completedAt" :aria-label="'完成 '+t.title" @change="toggleTask(t)"/>
            <div class="task-detail"><div :class="{done:!!t.completedAt}">{{ t.title }}</div>
              <small>{{ t.visibility==='private'?'🔒 仅自己':'⌂ 家庭共享' }} · {{ t.dueOn||'无截止日' }}</small></div>
            <button v-if="t.creatorUserId===user.id" class="text-button" @click="editTask(t)" :aria-label="'编辑 '+t.title">编辑</button>
            <button v-if="t.creatorUserId===user.id" class="text-button" @click="deleteTask(t)" :aria-label="'删除 '+t.title">×</button>
          </div>
        </section>
      </template>
      <template v-else-if="tab==='family'">
        <section class="panel"><h2>家庭成员</h2><p><a href="/api/export" download class="text-button">导出当前账户可查看的数据备份（JSON）</a></p><div class="profiles"><div v-for="p in profiles" :key="p.id" class="profile">
          <span>{{ p.type==='pet'?'🐾':'♡' }}</span><div><b>{{ p.displayName }}</b>
          <p>{{ p.type==='pet'?'宠物':'家庭成员' }} · {{ p.birthday||'未填写生日' }}</p></div></div></div></section>
        <section v-if="user.role==='owner'" class="panel">
          <h2>添加家庭或宠物档案</h2>
          <form class="task-form" @submit.prevent="addProfile">
            <input v-model="name" required maxlength="60" placeholder="昵称或名字"/>
            <select v-model="petType"><option value="person">家庭成员</option><option value="pet">宠物</option></select>
            <label>生日<input v-model="birth" type="date"/></label>
            <label v-if="petType==='pet'">到家日<input v-model="adopted" type="date"/></label>
            <button class="primary">＋ 添加档案</button></form>
        </section>
        <section v-if="user.role==='owner'" class="panel"><h2>邀请家人独立登录</h2>
          <p class="hint">7 天有效的一次性邀请码，最多两个账号。</p>
          <button class="outline" @click="generateInvite">生成邀请码</button>
          <div v-if="invitation" class="invitation"><code>{{ invitation }}</code><p>仅发送给家人，请勿公开。</p></div>
        </section>
      </template>
      <template v-else-if="tab==='cat'">
        <section class="hero"><div><span>CAT · HOMEFLOW</span><h2>豆沙的每一天 🐾</h2><p>可以在任务中关联豆沙，护理周期会继续扩展。</p></div></section>
        <section v-for="p in pets" :key="p.id" class="panel"><h2>🐾 {{ p.displayName }}</h2>
          <p class="hint">生日：{{ p.birthday||'未填' }}　到家：{{ p.adoptedOn||'未填' }}</p></section>
        <PetHealthPanel v-for="p in pets" :key="p.id" :pet-id="p.id" :name="p.displayName" />
        <p v-if="!pets.length" class="panel empty">先在家庭页面创建豆沙的档案吧。</p>
      </template>
      <section v-else class="hero"><div><span>HOMEFLOW LIFE</span>
        <h2>{{ tab==='plans'?'让旅行心愿变成计划 ✈':'把值得纪念的时刻留下来 ♡' }}</h2>
        <p>心愿、旅行和家庭回忆，现在可以开始记录。</p></div></section>
      <PushPanel v-if="tab==='today'" />
      <LifePanel :mode="tab" :user-id="user.id" :profiles="profiles" :is-owner="user.role==='owner'" />
      <BackupPanel v-if="tab==='family'" :user-id="user.id" />
    </main>
    <nav v-if="user" class="nav" aria-label="页面导航">
      <button v-for="n in nav" :key="n.id" :class="['nav-item',{selected:tab===n.id}]" @click="tab=n.id">
        <span class="nav-icon">{{ n.icon }}</span><span>{{ n.label }}</span></button>
    </nav>
  </div>
</template>
