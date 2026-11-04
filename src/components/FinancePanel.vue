<script setup lang="ts">
import DateField from './DateField.vue'
import {computed,onMounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
type Item=Record<string,any>
const props=defineProps<{trips:Item[];goals:Item[];owner:boolean;embeddedKind?:'trip'|'goal';embeddedId?:string;initialPeriodKey?:string;initialCompletedPeriods?:string[]}>()
const emit=defineEmits<{completed:[completed:boolean,periodKey:string]}>()
const available=ref(false),checked=ref(false),kind=ref<'trip'|'goal'>(props.embeddedKind||'trip'),target=ref(props.embeddedId||'')
const start=ref(''),end=ref(''),entries=ref<Item[]>([]),links=ref<Item[]>([])
const nextCursor=ref<string|null>(null),busy=ref(false),error=ref('')
const linkedPageSize=5
const linkedVisibleCount=ref(linkedPageSize)
const visibleLinks=computed(()=>links.value.slice(0,linkedVisibleCount.value))
const {toast,notify,clear:clearToast}=usePageToast()
const options=computed(()=>kind.value==='trip'?props.trips:props.goals)
const selected=computed(()=>options.value.find(x=>x.id===target.value))
const total=computed(()=>links.value.reduce((n,item)=>n+Number(item.entry?.amount||0),0))
const adjustment=ref('0'),opening=ref(0),net=ref(0),netLoaded=ref(false),netBusy=ref(false)
const periodKey=ref(''),periodFuture=ref(false)
const completedPeriods=ref<string[]>(props.initialCompletedPeriods||[])
const currentMarkKey=computed(()=>recurringGoal.value?String(periodKey.value):'once')
const alreadyCompleted=computed(()=>completedPeriods.value.includes(currentMarkKey.value))
const confirmBusy=ref(false)
const goalMode=computed(()=>selected.value?.goal_mode||'once')
const recurringGoal=computed(()=>kind.value==='goal'&&goalMode.value!=='once')
const goalStartOn=computed(()=>String(selected.value?.start_on||''))
const modeLabel=computed(()=>goalMode.value==='monthly'?'每月':goalMode.value==='yearly'?'每年':'累计')
function defaultPeriodKey(){
 const today=dateYmd(),start=goalStartOn.value
 const mode=goalMode.value
 const nowKey=mode==='yearly'?today.slice(0,4):today.slice(0,7)
 const startKey=mode==='yearly'?start.slice(0,4):start.slice(0,7)
 return startKey&&startKey>nowKey?startKey:nowKey
}
const actualWithAdjustment=computed(()=>total.value+Number(adjustment.value||0))
const goalTotal=computed(()=>(recurringGoal.value?0:opening.value)+net.value+Number(adjustment.value||0))
const goalProgress=computed(()=>Math.max(0,Math.min(100,goalTotal.value/Number(selected.value?.target_amount||1)*100)))
const goalPeriodDue=computed(()=>{
  const g=selected.value,today=dateYmd()
  if(!g||kind.value!=='goal')return false
  if(!recurringGoal.value)return !g.start_on||g.start_on<=today
  const key=String(periodKey.value)
  if(!(goalMode.value==='monthly'?/^\d{4}-(0[1-9]|1[0-2])$/.test(key):/^\d{4}$/.test(key)))return false
  const end=goalMode.value==='monthly'
    ?new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7)),0)).toISOString().slice(0,10)
    :key+'-12-31'
  const last=g.target_on&&g.target_on<end?g.target_on:end
  return !!last&&last<today&&(!g.start_on||g.start_on<=last)
})
const signed=(amount:number)=>(amount<0?'−':amount>0?'+':'')+'¥'+Math.abs(Number(amount||0)).toLocaleString('ja-JP')

const fmt=(amount:number)=>'¥'+Number(amount||0).toLocaleString('ja-JP')
const dateYmd=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
function defaultDates(){
  const date=new Date(Date.now()-29*86400000+9*3600000)
  start.value=date.toISOString().slice(0,10)
  end.value=dateYmd()
}
const ledgerErrors:Record<string,string>={
  goal_not_funded:'家計簿核算金额尚未达到储值目标，本期继续保留未完成。',
  ledger_verification_unavailable:'家計簿联动不可用，无法核验达标，完成状态没有改变。',
  owner_required_for_ledger_verification:'需要家庭管理员核验储值目标。',
  invalid_goal_period:'期间还未到期或日期不正确，请检查储值计划日期。',
  ledger_auth_failed:'家計簿联动密钥验证失败：两边密钥必须完全相同，仅使用英文字母、数字、_ 或 -。',
  ledger_source_token_missing:'家計簿生产环境未读取到联动密钥，请检查 Pages Secret 并重新部署。',
  ledger_source_db_unavailable:'家計簿接口读取数据库失败，请检查生产 D1 绑定与日志。',
  ledger_source_unavailable:'家計簿接口暂时不可用（503），请检查 Pages 部署与运行日志。',
  ledger_endpoint_missing:'找不到家計簿联动接口（404），请确认生产部署包含对应 API。',
  ledger_access_blocked:'家計簿联动接口拒绝访问（403），请检查安全或访问规则。',
  ledger_network_error:'HomeFlow 无法连接家計簿接口，请检查网络或 Cloudflare 请求日志。',
  ledger_timeout:'家計簿接口响应超时，请稍后重试。',
  ledger_invalid_response:'家計簿接口返回的数据格式不正确。',
  ledger_upstream_unavailable:'家計簿接口返回错误，请检查 Cloudflare 运行日志。',
  ledger_connection_unavailable:'家計簿联动失败，当前无法定位具体原因。'
}
async function api(path:string,method='GET',payload?:unknown):Promise<any>{
  const r=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
    ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})})
  const data=await r.json()
  if(!r.ok)throw Error(ledgerErrors[data.error]||data.error||'操作失败')
  return data
}
async function refreshCompletionMarks(){
  if(kind.value!=='goal'||!target.value)return
  try{
    const result=await api('/goals/'+encodeURIComponent(target.value))
    if(Array.isArray(result.completedPeriods))
      completedPeriods.value=result.completedPeriods.filter((x:unknown)=>typeof x==='string')
  }catch(e){error.value=(e as Error).message}
}
async function confirmGoalCompleted(){
  if(kind.value!=='goal'||!selected.value||confirmBusy.value||!goalPeriodDue.value)return
  confirmBusy.value=true;error.value=''
  const key=currentMarkKey.value,wasCompleted=alreadyCompleted.value
  try{
    // Server always verifies actual Kakebo net plus the saved settings,
    // regardless of any client-rendered progress bar.
    await api('/plans/complete','POST',{
      kind:'goal',id:target.value,periodKey:key,completed:!wasCompleted
    })
    if(wasCompleted)completedPeriods.value=completedPeriods.value.filter(x=>x!==key)
    else completedPeriods.value=[...completedPeriods.value,key]
    notify(wasCompleted?'已撤销本期达标确认':'家庭净结余目标核验通过，已记录完成')
    emit('completed',!wasCompleted,key)
  }catch(e){error.value=(e as Error).message}
  finally{confirmBusy.value=false}
}
async function settleRecurringGoal(){
 if(!recurringGoal.value||!selected.value||!goalPeriodDue.value||confirmBusy.value)return
 confirmBusy.value=true;error.value=''
 try{
   const data=await api('/goals/'+encodeURIComponent(target.value)+'/periods/settle','POST',
     {periodKey:String(periodKey.value)})
   const key=String(periodKey.value)
   if(data.status==='met'){
     if(!completedPeriods.value.includes(key))completedPeriods.value=[...completedPeriods.value,key]
   }else completedPeriods.value=completedPeriods.value.filter(x=>x!==key)
   notify(data.status==='met'?'本期已结算 · 达标':
     '本期已结算 · 不足 '+fmt(Math.max(0,Number(data.differenceAmount||0)))+'，记录已保存')
   emit('completed',data.status==='met',key)
 }catch(e){error.value=(e as Error).message}
 finally{confirmBusy.value=false}
}
async function detect(){
  if(!props.owner)return
  try{
    const status=await api('/finance/status')
    available.value=!!status.connected;checked.value=true
    if(available.value&&target.value)await Promise.all([refreshSettings(),refreshLinks()])
  }catch(e){error.value=(e as Error).message;checked.value=true}
}
async function loadGoalNet(){
  if(kind.value!=='goal'||!target.value||
    (recurringGoal.value?!periodKey.value:(!start.value||!end.value)))return
  const requestedId=target.value,requestedKey=periodKey.value
  const requestedStart=start.value,requestedEnd=end.value
  netBusy.value=true;netLoaded.value=false;periodFuture.value=false
  try{
    const params=new URLSearchParams({targetId:requestedId})
    if(recurringGoal.value)params.set('periodKey',requestedKey)
    else{params.set('start',requestedStart);params.set('end',requestedEnd)}
    const data=await api('/finance/goal/net?'+params.toString())
    if(kind.value!=='goal'||target.value!==requestedId||
      (recurringGoal.value?periodKey.value!==requestedKey:
       start.value!==requestedStart||end.value!==requestedEnd))return
    net.value=Number(data.net||0)
    if(recurringGoal.value){start.value=String(data.start||'');end.value=String(data.end||'')}
    periodFuture.value=!!data.notStarted;netLoaded.value=true
  }catch(e){error.value=(e as Error).message}
  finally{netBusy.value=false}
}
async function refreshSettings(){
  adjustment.value='0';opening.value=0;net.value=0;netLoaded.value=false;periodFuture.value=false
  if(!available.value||!target.value)return
  const requestedId=target.value,requestedKind=kind.value,requestedKey=periodKey.value
  try{
    const params=new URLSearchParams({type:requestedKind,targetId:requestedId})
    if(recurringGoal.value)params.set('periodKey',requestedKey)
    const data=await api('/finance/settings?'+params.toString())
    if(requestedId!==target.value||requestedKind!==kind.value||
      (recurringGoal.value&&requestedKey!==periodKey.value))return
    adjustment.value=String(data.adjustmentAmount||0)
    opening.value=recurringGoal.value?0:Number(data.openingAmount||0)
    if(requestedKind==='goal'){
      if(data.periodStart&&data.periodEnd){start.value=data.periodStart;end.value=data.periodEnd}
      await loadGoalNet()
    }
  }catch(e){error.value=(e as Error).message}
}
async function saveSettings(){
  if(!target.value)return
  const amount=Number(adjustment.value)
  if(!/^-?\d+$/.test(adjustment.value.trim())||!Number.isSafeInteger(amount)||Math.abs(amount)>100000000000){
    error.value='调整额请输入有效的整数日元';return
  }
  busy.value=true;error.value='';clearToast()
  try{
    const payload:Record<string,unknown>={type:kind.value,targetId:target.value,adjustmentAmount:amount}
    if(recurringGoal.value)payload.periodKey=periodKey.value
    else{
      payload.periodStart=kind.value==='goal'?start.value:null
      payload.periodEnd=kind.value==='goal'?end.value:null
    }
    await api('/finance/settings','PUT',payload)
    notify(recurringGoal.value?'本期调整额已保存，如已结算请重新核验':'调整额和设置已保存，不会修改家計簿')
    if(kind.value==='goal')await loadGoalNet()
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function refreshLinks(){
  links.value=[]
  if(!available.value||!target.value||kind.value!=='trip')return
  try{
    const data=await api('/finance/links?type='+encodeURIComponent(kind.value)+'&targetId='+encodeURIComponent(target.value))
    links.value=data.items||[]
  }catch(e){error.value=(e as Error).message}
}
async function loadCandidates(more=false){
  if(!available.value||!start.value||!end.value||!target.value)return
  busy.value=true;error.value='';clearToast()
  try{
    const params=new URLSearchParams({start:start.value,end:end.value})
    if(more&&nextCursor.value)params.set('cursor',nextCursor.value)
    const data=await api('/finance/candidates?'+params.toString())
    entries.value=more?[...entries.value,...(data.entries||[])]:data.entries||[]
    nextCursor.value=data.nextCursor||null
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function linkEntry(entry:Item){
  if(!target.value)return
  busy.value=true;error.value=''
  try{
    await api('/finance/links','POST',{type:kind.value,targetId:target.value,entryId:entry.id})
    await refreshLinks();notify('已关联家計簿支出，不会重复记账')
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function unlink(item:Item){
  busy.value=true;error.value=''
  try{
    await api('/finance/links/'+encodeURIComponent(item.linkId),'DELETE')
    await refreshLinks();notify('已取消关联，原记账明细不受影响')
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
function resetGoalPeriod(){
  if(kind.value!=='goal')return
  if(recurringGoal.value)periodKey.value=props.initialPeriodKey||defaultPeriodKey()
  else if(goalStartOn.value){start.value=goalStartOn.value;end.value=dateYmd()}
}
watch([kind,target],()=>{
  entries.value=[];nextCursor.value=null;linkedVisibleCount.value=linkedPageSize
  const previousKey=periodKey.value
  resetGoalPeriod()
  void refreshLinks()
  if(periodKey.value===previousKey||!recurringGoal.value)void refreshSettings()
})
watch(kind,()=>{target.value=''})
watch(periodKey,()=>{if(recurringGoal.value&&available.value)void refreshSettings()})
watch([start,end],()=>{if(!recurringGoal.value)netLoaded.value=false})
watch(selected,value=>{
  if(!value)return
  if(kind.value==='goal'){resetGoalPeriod();return}
  const s=value.startOn||value.start_on
  const e=value.endOn||value.end_on
  if(s&&e){
    const days=Math.round((Date.parse(e+'T00:00:00Z')-Date.parse(s+'T00:00:00Z'))/86400000)
    if(days<=90&&days>=0){start.value=s;end.value=e}
  }
})
onMounted(()=>{
  defaultDates()
  const x=selected.value
  if(kind.value==='goal')resetGoalPeriod()
  else if(x&&kind.value==='trip'){
    const s=x.startOn||x.start_on,e=x.endOn||x.end_on
    if(s&&e&&Date.parse(e)-Date.parse(s)<=90*86400000){start.value=s;end.value=e}
  }
  void detect()
  // Focused navigation already fetched completion marks by ID; avoid
  // a duplicate D1 lookup when opening from Today.
  if(kind.value==='goal'&&!props.initialPeriodKey)void refreshCompletionMarks()
})
</script>
<template>
  <section v-if="owner" class="finance-card">
    <h2 class="finance-title"><AppIcon name="wallet" :size="20" /> {{ embeddedId?(kind==='trip'?'旅行费用 · 家計簿关联':'储值计划 · 家計簿收支'):'家計簿 · 旅行支出与储蓄进度' }}</h2>
    <p class="hint">旅行计划关联实际消费；储值计划可按累计、每月或每年目标计算期间收支差额。调整额按所选期间保存，不修改原账目。</p>
    <div v-if="!checked" class="hint">正在检查连接状态…</div>
    <p v-else-if="!available" class="hint">
      家計簿只读联动尚未连接，请检查 Cloudflare 私有 Service Binding。
    </p>
    <template v-else>
      <div v-if="!embeddedId" class="fields">
        <label>关联对象
          <select v-model="kind"><option value="trip">旅行计划</option><option value="goal">储值计划</option></select>
        </label>
        <label>选择项目
          <select v-model="target"><option value="">请选择</option>
            <option v-for="item in options" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
        </label>
      </div>
      <template v-if="target">
        <div v-if="kind==='trip'" class="summary">
          <span>已关联实际支出</span><strong>{{ fmt(total) }}</strong>
          <small>{{ links.filter(x=>x.entry).length }} 笔已确认的真实支出</small>
          <span>手动调整 {{ signed(Number(adjustment)||0) }}</span>
          <strong>调整后旅行开销 {{ signed(actualWithAdjustment) }}</strong>
        </div>
        <div v-else class="summary">
          <span>{{ modeLabel }}目标金额 {{ fmt(Number(selected?.target_amount||0)) }}</span>
          <span v-if="!recurringGoal">期初储值额 {{ fmt(opening) }}</span>
          <span>{{ recurringGoal?'本期':'所选期间' }}收支差额 {{ netLoaded?signed(net):'尚未读取' }}</span>
          <span>本{{ recurringGoal?'期':'' }}手动调整 {{ signed(Number(adjustment)||0) }}</span>
          <strong v-if="netLoaded">{{ recurringGoal?'本期预计储值':'储值进度金额' }} {{ signed(goalTotal) }}</strong>
          <small v-if="netLoaded">本{{ recurringGoal?'期':'' }}完成率 {{ goalProgress.toFixed(1) }}%</small>
          <small v-if="periodFuture">所选期间还未开始，暂不查询家計簿。</small>
          <small v-else>此处仅是家計簿「家庭净收支」估算（含期初额和调整额），不代表银行余额，也不能证明这笔钱已专门存入该目标；资产移动不计入。</small>
        </div>
        <label class="adjustment-label">手动调整额（円，可输入正数或负数）
          <input v-model="adjustment" type="number" step="1" inputmode="numeric" />
        </label>
        <div v-if="recurringGoal" class="fields">
          <label v-if="goalMode==='monthly'">选择月份
            <input v-model="periodKey" type="month" :min="goalStartOn.slice(0,7)||undefined" /></label>
          <label v-else>选择年份
            <input v-model="periodKey" type="number" inputmode="numeric" max="9998"
              :min="Number(goalStartOn.slice(0,4))||1900" step="1"/></label>
          <small>本期计算范围：{{ start||'—' }} ～ {{ end||'—' }}；首期从计划开始日期算起。</small>
        </div>
        <div v-else class="fields">
          <label>起始日期<DateField v-model="start" :min="kind==='goal'?goalStartOn||undefined:undefined" /></label>
          <label>结束日期<DateField v-model="end" :min="start||undefined" /></label>
        </div>
        <div class="finance-actions">
          <button type="button" :disabled="busy" @click="saveSettings">保存{{ recurringGoal?'本期':'' }}调整额{{ kind==='goal'&&!recurringGoal?'和期间':'' }}</button>
          <button v-if="kind==='goal'" type="button" :disabled="netBusy||busy" @click="loadGoalNet">
            {{ netBusy?'读取中…':'刷新收支差额' }}
          </button>
          <button v-else type="button" :disabled="busy" @click="loadCandidates(false)">查找家計簿支出</button>
        </div>
        <div v-if="kind==='goal'" class="goal-completion-panel">
          <p v-if="!recurringGoal&&alreadyCompleted" class="hint">这一次储值已确认完成。</p>
          <p v-else-if="goalPeriodDue" class="hint">
            服务器将按「家庭净结余目标」核对真实收支、调整额和期初金额。通过只代表结余估算达标，不代表专用储蓄账户已有这笔钱。
          </p>
          <p v-else class="hint">{{ recurringGoal?'本期尚未结束':'储值起始日期尚未到来' }}，暂不能确认。</p>
          <button v-if="recurringGoal" type="button" :disabled="confirmBusy||busy||!goalPeriodDue"
            @click="settleRecurringGoal">{{ confirmBusy?'正在核验…':'核验并结算本期（达标或未达标）' }}</button>
          <button v-else type="button" :disabled="confirmBusy||busy||!goalPeriodDue" @click="confirmGoalCompleted">
            {{ confirmBusy?'正在核验…':alreadyCompleted?'撤销达标确认':'核验达标并完成' }}
          </button>
          <small class="hint">调整期间或金额后请先保存，再进行核验；不会修改家計簿原始账目。</small>
        </div>
        <template v-if="kind==='trip'">
          <div v-for="row in visibleLinks" :key="row.linkId" class="line">
            <span>{{ row.entry?.date||'原账目已删除' }} · {{ row.entry?.merchant||('明细 #'+row.entryId) }}
              <small>{{ row.entry?fmt(row.entry.amount):'未找到明细' }}</small></span>
            <button type="button" class="unlink" @click="unlink(row)" :disabled="busy">移除关联</button>
          </div>
          <button v-if="links.length>visibleLinks.length" type="button" class="more"
            @click="linkedVisibleCount+=linkedPageSize">加载更多已关联支出（每次 5 条）</button>
          <div v-for="row in entries" :key="row.id" class="line">
            <span>{{ row.date }} · {{ row.merchant||row.category }}<small>{{ fmt(row.amount) }}</small></span>
            <button type="button" :disabled="busy || links.some(x=>String(x.entryId)===String(row.id))" @click="linkEntry(row)">
              {{ links.some(x=>String(x.entryId)===String(row.id))?'已关联':'关联' }}</button>
          </div>
          <button v-if="nextCursor" type="button" class="more" :disabled="busy" @click="loadCandidates(true)">加载更多支出</button>
        </template>
      </template>
    </template>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <PageToast :toast="toast" />
  </section>
</template>
<style scoped>
.finance-card{background:#fff;border:1px solid #eceae4;border-radius:18px;padding:18px;margin-top:16px}
.finance-card h2{font-size:17px;margin:0 0 10px}.hint{font-size:12px;line-height:1.7;color:#839087}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0;min-width:0}
.fields label{font-size:12px;color:#607469;display:grid;gap:5px;min-width:0;max-width:100%}
.fields select,.fields input{border:1px solid #dce6dc;border-radius:10px;min-width:0;max-width:100%;box-sizing:border-box;width:100%;min-height:41px;padding:8px;background:#fff}
button{background:#488d6c;color:#fff;border:0;border-radius:9px;padding:9px 12px;font-size:12px}
button:disabled{opacity:.55}.summary{background:#eaf4ec;border-radius:12px;padding:14px;display:grid;gap:3px;margin:14px 0}
.summary strong{font-size:22px}.summary span,.summary small{font-size:12px;color:#587564}
.line{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #f0eee9;padding:10px 0;font-size:12px}
.line span{min-width:0;overflow-wrap:anywhere}.line small{display:block;color:#7a9083;margin-top:3px}
.line .unlink{background:#f3f5ee;color:#758978}.more{margin-top:8px;background:#eef5ed;color:#488d6c}
.adjustment-label{display:grid;gap:6px;margin:12px 0;font-size:12px;color:#607469}
.adjustment-label input{width:100%;max-width:100%;box-sizing:border-box;border:1px solid #dce6dc;border-radius:10px;padding:9px;min-height:41px;background:#fff;color:#253a31}
.finance-actions{display:flex;flex-wrap:wrap;gap:8px}
.goal-completion-panel{display:grid;gap:8px;margin-top:14px;padding:12px;
  background:#f4f9f5;border:1px solid #dbe9dd;border-radius:11px}
.goal-completion-panel button{width:max-content;max-width:100%}
.goal-completion-panel .hint{margin:0}
.error{font-size:12px;color:#a94d37}.success{font-size:12px;color:#3f876a}
@media(max-width:720px){.fields{grid-template-columns:minmax(0,1fr)}}
</style>
