<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'

type State='pending'|'approved'|'rejected'|'cancelled'|'executing'|'applied'|
 'failed_retryable'|'failed_final'|'expired'|'conflict'
type Approval={
 request_id:string;source_app:string;target_app:string;resource_type:string
 operation:string;resource_id:string|null;requester_user_id:string
 approver_user_id:string|null;status:State;created_at:number
 reviewed_at:number|null;executed_at:number|null;expires_at:number
 remote_id:string|null;applied:boolean
}
const props=defineProps<{
 active:boolean;userId:string;isOwner:boolean
 members?:Array<{id:string;loginName:string}>
}>()
const allowedFilters=['','pending','approved','applied','rejected',
 'failed_retryable','conflict','cancelled'] as const
type Filter=typeof allowedFilters[number]
const enabled=ref(false),executionEnabled=ref(false)
const filter=ref<Filter>('pending')
const items=ref<Approval[]>([]),page=ref(0),hasMore=ref(false)
const expanded=ref(false),loading=ref(false),busyId=ref('')
const error=ref(''),message=ref('')
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
let epoch=0
const statusNames:Record<State,string>={
 pending:'待审批',approved:'已批准 · 未入账',
 rejected:'已拒绝',cancelled:'已取消',executing:'执行中',
 applied:'已生效',failed_retryable:'等待重试',
 failed_final:'执行失败',expired:'已过期',conflict:'处理冲突'
}
const actionNames:Record<string,string>={
 'finance.entry.create':'新增家庭账务',
 'finance.entry.update':'修改家庭账务',
 'finance.entry.delete':'删除家庭账务',
 'finance.entry.restore':'恢复家庭账务',
 'finance.account.public_rule.change':'调整家庭财务规则',
 'document.sync.finance':'文书同步到账本',
 'document.sync.homeflow':'文书同步到家庭',
 'document.sync.study':'文书同步到知学',
 'homeflow.shared_task.create':'创建家庭待办'
}
const available=computed(()=>props.active&&enabled.value)
function person(id:string|null){
 if(!id)return '家庭成员'
 return props.members?.find(m=>m.id===id)?.loginName||(id===props.userId?'我':'家庭成员')
}
function time(ms:number|null){
 if(!ms||!Number.isFinite(ms))return ''
 return new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hour12:false
 }).format(new Date(ms))
}
async function getJson(url:string,options?:RequestInit){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options})
 const raw=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(String(raw.error||raw.code||'操作失败，请刷新重试'))
 return raw
}
async function discover(){
 const ticket=++epoch
 enabled.value=false;executionEnabled.value=false;expanded.value=false
 items.value=[];page.value=0;hasMore.value=false
 error.value='';message.value='';busyId.value=''
 if(!props.active||!props.userId)return
 try{
  const result=await getJson('/api/approvals/status')
  if(ticket!==epoch||!props.active)return
  enabled.value=result.enabled===true
  executionEnabled.value=result.execution_enabled===true
  filter.value=props.isOwner?'pending':''
 }catch{/* Feature is deliberately hidden while migrations/flags are OFF. */}
}
watch(()=>[props.active,props.userId,props.isOwner],()=>{void discover()},{immediate:true})
async function load(reset=true){
 if(!available.value||loading.value||busyId.value)return
 const ticket=epoch
 const account=props.userId,kind=filter.value
 const nextPage=reset?0:page.value
 loading.value=true;error.value='';message.value=''
 try{
  const url='/api/approvals?page='+nextPage+
   (kind?'&status='+encodeURIComponent(kind):'')
  const result=await getJson(url)
  if(ticket!==epoch||!props.active||account!==props.userId||kind!==filter.value)return
  items.value=Array.isArray(result.items)?result.items:[]
  page.value=nextPage
  hasMore.value=result.has_more===true
 }catch(e){if(ticket===epoch)error.value=(e as Error).message}
 finally{if(ticket===epoch)loading.value=false}
}
async function toggle(){
 expanded.value=!expanded.value
 if(expanded.value)await load(true)
}
function selectFilter(e:Event){
 const value=(e.target as HTMLSelectElement).value
 if(!allowedFilters.includes(value as Filter))return
 filter.value=value as Filter
 page.value=0
 void load(true)
}
function changePage(delta:number){
 if((delta>0&&!hasMore.value)||(delta<0&&page.value===0))return
 page.value=Math.max(0,page.value+delta)
 void load(false)
}
async function act(item:Approval,kind:'approve'|'reject'|'execute'){
 if(busyId.value||loading.value||!available.value||!props.isOwner)return
 const id=item.request_id,account=props.userId
 const chosenStatus=item.status
 const options=kind==='execute'
  ?{title:'执行已批准账务',confirmLabel:'确认执行',
    message:'系统会再次核实批准记录，并由家計簿实际入账。同一审批只能入账一次。'}
  :kind==='approve'
   ?{title:'批准家庭申请',confirmLabel:'确认批准',
     message:'批准后还需要单独执行，账本此时不会立即改变。'}
   :{title:'拒绝家庭申请',confirmLabel:'确认拒绝',
     message:'拒绝后不会修改家庭正式账本。',danger:true}
 if(!await confirmAction(options))return
 if(account!==props.userId||!props.active)return
 // Never execute an item whose status moved while confirmation was open.
 if(item.status!==chosenStatus)return
 busyId.value=id;error.value='';message.value=''
 try{
  const path=kind==='execute'?'/api/approvals/'+id+'/execute':
   '/api/approvals/'+id+'/review'
  const payload=kind==='execute'?{}:{decision:kind}
  const result=await getJson(path,{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify(payload)})
  if(account!==props.userId||!props.active)return
  message.value=kind==='approve'?'已批准，尚未入账':
   kind==='reject'?'已拒绝，不会入账':
   result.applied===true?'已执行并入账':'执行结果待核对'
 }catch(e){if(account===props.userId)error.value=(e as Error).message}
 finally{
  if(account===props.userId){busyId.value='';await load(true)}
 }
}
</script>

<template>
 <section v-if="available" class="panel approval-center" aria-label="家庭审批中心">
  <div class="approval-head">
   <div class="management-section-heading">
    <AppIcon name="shield" :size="20"/>
    <h2>家庭审批</h2>
   </div>
   <button type="button" class="approval-toggle outline"
     :aria-expanded="expanded" @click="toggle">
     {{ expanded?'收起':'查看' }}
   </button>
  </div>
  <div v-if="expanded" class="approval-content">
   <div class="approval-toolbar">
    <label for="approval-filter">状态</label>
    <select id="approval-filter" :value="filter" :disabled="loading||!!busyId"
      @change="selectFilter">
     <option value="">全部</option>
     <option value="pending">待审批</option>
     <option value="approved">已批准未入账</option>
     <option value="applied">已生效</option>
     <option value="rejected">已拒绝</option>
     <option value="failed_retryable">可重试</option>
     <option value="conflict">冲突</option>
     <option value="cancelled">已取消</option>
    </select>
    <button class="outline" type="button" :disabled="loading||!!busyId"
      @click="load(true)">刷新</button>
   </div>
   <p v-if="error" class="approval-error" role="alert">{{ error }}</p>
   <p v-if="message" class="approval-feedback" role="status">{{ message }}</p>
   <p v-if="loading" class="approval-empty" role="status">读取中…</p>
   <p v-else-if="items.length===0" class="approval-empty">暂无申请</p>
   <ul v-else class="approval-list">
    <li v-for="item in items" :key="item.request_id" class="approval-item">
     <div class="approval-titleline">
      <b>{{ actionNames[item.operation]||'家庭操作申请' }}</b>
      <span class="approval-state" :data-status="item.status">
       {{ statusNames[item.status]||'处理中' }}
      </span>
     </div>
     <div class="approval-meta">
      <span>{{ person(item.requester_user_id) }}</span>
      <span>{{ time(item.created_at) }}</span>
     </div>
     <p v-if="item.status==='approved'" class="approval-note">
      已批准，账本尚未生效
     </p>
     <div v-if="isOwner&&item.status==='pending'" class="approval-actions">
      <button class="outline" type="button" :disabled="!!busyId||loading"
       @click="act(item,'reject')">拒绝</button>
      <button class="primary" type="button" :disabled="!!busyId||loading"
       @click="act(item,'approve')">批准</button>
     </div>
     <div v-else-if="isOwner&&item.status==='approved'&&executionEnabled"
       class="approval-actions">
      <button class="primary" type="button" :disabled="!!busyId||loading"
       @click="act(item,'execute')">执行入账</button>
     </div>
    </li>
   </ul>
   <div v-if="items.length" class="approval-pager">
    <button type="button" class="outline" :disabled="page===0||loading||!!busyId"
     @click="changePage(-1)">上一页</button>
    <span>第 {{ page+1 }} 页</span>
    <button type="button" class="outline" :disabled="!hasMore||loading||!!busyId"
     @click="changePage(1)">下一页</button>
   </div>
  </div>
  <ConfirmActionSheet v-if="confirmRequest" :request="confirmRequest"
   @confirm="acceptConfirm" @cancel="cancelConfirm"/>
 </section>
</template>
<style scoped>
.approval-center{min-width:0}
.approval-head,.approval-titleline,.approval-toolbar,.approval-pager{
 display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0
}
.approval-head h2{margin:0}
.approval-toggle{min-width:72px;min-height:40px;padding:6px 11px}
.approval-content{display:grid;gap:10px;margin-top:12px;min-width:0}
.approval-toolbar label{font-size:12px;color:var(--ui-muted);flex:none}
.approval-toolbar select{max-width:180px;flex:1 1 130px;min-width:0;
 min-height:44px;border:1px solid var(--ui-line);border-radius:10px;
 padding:8px;background:#fff;font-size:13px}
.approval-toolbar button{min-height:44px;padding:8px 12px;flex:none}
.approval-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.approval-item{border:1px solid var(--ui-line);border-radius:12px;
 padding:12px;min-width:0;overflow-wrap:anywhere;background:#fbfdfb}
.approval-titleline{align-items:flex-start}
.approval-titleline b{font-size:14px;min-width:0}
.approval-state{flex:none;border-radius:20px;padding:3px 8px;
 background:#eef3ef;color:#5c7968;font-size:11px;line-height:1.4}
.approval-state[data-status="pending"]{background:#fff5df;color:#86621c}
.approval-state[data-status="applied"]{background:#e7f4e9;color:#327457}
.approval-state[data-status="rejected"],.approval-state[data-status="conflict"]{
 background:#fff0ee;color:#a14b4b}
.approval-meta{display:flex;justify-content:space-between;gap:8px;
 color:var(--ui-muted);font-size:12px;margin-top:7px}
.approval-note{margin:8px 0 0;color:#916927;font-size:12px}
.approval-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.approval-actions button{min-height:44px;min-width:96px}
.approval-empty{text-align:center;color:var(--ui-muted);font-size:13px;margin:8px 0}
.approval-error{font-size:12px;color:#b34f45;margin:0}
.approval-feedback{font-size:12px;color:#367657;margin:0}
.approval-pager{justify-content:center;font-size:12px;color:var(--ui-muted)}
.approval-pager button{padding:7px 11px;min-height:42px}
@media(max-width:375px){.approval-titleline{flex-wrap:wrap}.approval-toolbar{gap:6px}}
</style>
