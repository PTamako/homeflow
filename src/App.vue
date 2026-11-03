<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import LifePanel from './components/LifePanel.vue'
type User={id:string;loginName:string;role:'owner'|'member';householdId:string;householdName:string}
type Profile={id:string;memberUserId:string|null;type:'person'|'pet';displayName:string;birthday:string|null;relation:string;adoptedOn:string|null;weightGrams:number|null;notes:string}
type Task={id:string;title:string;visibility:'private'|'household';dueOn:string|null;creatorUserId:string;subjectProfileId:string|null;completedAt:string|null}
type Data={ok?:boolean;error?:string;initialized?:boolean;bootstrapAvailable?:boolean;user?:User;profiles?:Profile[];tasks?:Task[];invitationCode?:string}
const user=ref<User|null>(null),profiles=ref<Profile[]>([]),tasks=ref<Task[]>([])
const tab=ref<'today'|'cat'|'family'|'plans'|'memories'>('today')
const authMode=ref<'login'|'bootstrap'|'join'>('login'),initialized=ref(true),loading=ref(false)
const login=ref(''),password=ref(''),displayName=ref(''),householdName=ref('我们的小家'),bootstrapSecret=ref(''),invite=ref('')
const title=ref(''),visibility=ref<'private'|'household'>('private'),due=ref(''),subjectId=ref('')
const name=ref(''),petType=ref<'pet'|'person'>('pet'),birth=ref(''),adopted=ref('')
const error=ref(''),invitation=ref(''),showDone=ref(false)
const nav=[{id:'today',icon:'☀',label:'今天'},{id:'plans',icon:'✓',label:'计划'},{id:'memories',icon:'▧',label:'时光轴'},{id:'cat',icon:'🐾',label:'豆沙'},{id:'family',icon:'⌂',label:'家庭'}] as const
const visibleTasks=computed(()=>tasks.value.filter(t=>showDone.value||!t.completedAt))
const pets=computed(()=>profiles.value.filter(p=>p.type==='pet'))
const errText=(key:string)=>{
  const map:Record<string,string>={invalid_credentials:'账号或密码错误',invalid_input:'请检查输入（密码至少 12 位）',
    bootstrap_not_configured:'请先配置 Cloudflare HOMEFLOW_BOOTSTRAP_SECRET',bootstrap_not_authorized:'启动密钥不正确',
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
    }
  }catch{
    user.value=null
    try{
      const status=await api('/auth/bootstrap-status')
      initialized.value=!!status.initialized
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
  try{await api('/auth/logout','POST',{})}catch{}
  user.value=null;profiles.value=[];tasks.value=[];await refresh()
}
async function loadTasks(){tasks.value=(await api('/tasks?status=all')).tasks||[]}
async function addTask(){
  if(!title.value.trim())return
  error.value='';loading.value=true
  try{
    await api('/tasks','POST',{title:title.value,notes:'',visibility:visibility.value,dueOn:due.value||null,
      subjectProfileId:subjectId.value||null})
    title.value='';due.value='';subjectId.value='';await loadTasks()
  }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
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
onMounted(refresh)
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
        <label>登录账号<input v-model="login" required maxlength="36" autocomplete="username" placeholder="字母、数字和下划线"/></label>
        <label v-if="authMode!=='login'">你的昵称<input v-model="displayName" required maxlength="60" autocomplete="nickname" placeholder="怎么称呼你？"/></label>
        <label>密码<input v-model="password" required type="password" minlength="12" autocomplete="current-password" placeholder="至少 12 位"/></label>
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
          <div class="row-between"><b>任务列表</b><label class="inline"><input v-model="showDone" type="checkbox"/> 显示已完成</label></div>
          <div v-if="!visibleTasks.length" class="empty">今天没有任务，添加一件小事吧。</div>
          <div v-for="t in visibleTasks" :key="t.id" class="task-row">
            <input type="checkbox" :checked="!!t.completedAt" :aria-label="'完成 '+t.title" @change="toggleTask(t)"/>
            <div class="task-detail"><div :class="{done:!!t.completedAt}">{{ t.title }}</div>
              <small>{{ t.visibility==='private'?'🔒 仅自己':'⌂ 家庭共享' }} · {{ t.dueOn||'无截止日' }}</small></div>
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
        <p v-if="!pets.length" class="panel empty">先在家庭页面创建豆沙的档案吧。</p>
      </template>
      <section v-else class="hero"><div><span>HOMEFLOW LIFE</span>
        <h2>{{ tab==='plans'?'让旅行心愿变成计划 ✈':'把值得纪念的时刻留下来 ♡' }}</h2>
        <p>心愿、旅行和家庭回忆，现在可以开始记录。</p></div></section>
      <LifePanel :mode="tab" :user-id="user.id" :profiles="profiles" />
    </main>
    <nav v-if="user" class="nav" aria-label="页面导航">
      <button v-for="n in nav" :key="n.id" :class="['nav-item',{selected:tab===n.id}]" @click="tab=n.id">
        <span class="nav-icon">{{ n.icon }}</span><span>{{ n.label }}</span></button>
    </nav>
  </div>
</template>
