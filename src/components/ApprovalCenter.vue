<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import {executeApprovedBatch} from '../approval-batch-execution.mjs'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'

type State='pending'|'approved'|'rejected'|'cancelled'|'executing'|'applied'|
 'failed_retryable'|'failed_final'|'expired'|'conflict'
type Approval={
 request_id:string;source_app:string;target_app:string;resource_type:string
 operation:string;resource_id:string|null;requester_user_id:string
 approver_user_id:string|null;status:State;created_at:number
 reviewed_at:number|null;executed_at:number|null;expires_at:number
 remote_id:string|null;applied:boolean;version:number
}
const props=defineProps<{
 active:boolean;userId:string;isOwner:boolean
 autoOpen?:boolean;compact?:boolean
 members?:Array<{id:string;loginName:string}>
 profiles?:Array<{memberUserId:string|null;displayName:string}>
}>()
const allowedFilters=['','pending','approved','applied','rejected',
 'failed_retryable','conflict','cancelled'] as const
type Filter=typeof allowedFilters[number]
const enabled=ref(false),executionEnabled=ref(false),documentExecutionEnabled=ref(false),sharedEntryExecutionEnabled=ref(false)
const batchReviewEnabled=ref(false),selectedIds=ref<string[]>([])
const selectedExecutionIds=ref<string[]>([])
type BatchRequest={batch_id:string;decision:'approve'|'reject';expected_user_id:string;items:Array<{request_id:string;expected_version:number}>}
const unconfirmedBatch=ref<BatchRequest|null>(null)
const filter=ref<Filter>('pending')
const items=ref<Approval[]>([]),page=ref(0),hasMore=ref(false)
const expanded=ref(false),loading=ref(false),busyId=ref('')
const error=ref(''),message=ref('')
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
let epoch=0
// A changed filter or HomeFlow user invalidates the previous network response.
// Do not hold the screen locked behind an obsolete, slow PWA fetch.
let requestGeneration=0
let inFlightQuery=''
const statusNames:Record<State,string>={
 pending:'待审批',approved:'已批准 · 自动入账中',
 rejected:'已拒绝',cancelled:'已取消',executing:'执行中',
 applied:'已生效',failed_retryable:'自动核对中',
 failed_final:'执行失败',expired:'已过期',conflict:'处理冲突'
}
const actionNames:Record<string,string>={
 'finance.entry.create':'新增家庭账务',
 'finance.asset_transfer.bank_to_bank':'已到账银行间资产转移',
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
 return props.profiles?.find(p=>p.memberUserId===id)?.displayName||
  props.members?.find(m=>m.id===id)?.loginName||(id===props.userId?'我':'家庭成员')
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
 requestGeneration++
 inFlightQuery=''
 loading.value=false
 cancelConfirm()
 enabled.value=false;executionEnabled.value=false;sharedEntryExecutionEnabled.value=false;batchReviewEnabled.value=false;expanded.value=false
 selectedIds.value=[];selectedExecutionIds.value=[];unconfirmedBatch.value=null;documentExecutionEnabled.value=false
 items.value=[];page.value=0;hasMore.value=false
 error.value='';message.value='';busyId.value=''
 if(!props.active||!props.userId)return
 try{
  const result=await getJson('/api/approvals/status')
  if(ticket!==epoch||!props.active)return
  enabled.value=result.enabled===true
  executionEnabled.value=result.execution_enabled===true
   sharedEntryExecutionEnabled.value=result.shared_entry_execution_enabled===true
   batchReviewEnabled.value=result.batch_review_enabled===true
   documentExecutionEnabled.value=result.document_execution_enabled===true
  filter.value=props.isOwner?'pending':''
  if(props.autoOpen){expanded.value=true;await load(true)}
 }catch{/* Feature is deliberately hidden while migrations/flags are OFF. */}
}
watch(()=>[props.active,props.userId,props.isOwner],()=>{void discover()},{immediate:true})
async function load(reset=true,preserveFeedback=false){
 if(!available.value||busyId.value)return
 const ticket=epoch
 const account=props.userId,kind=filter.value
 const nextPage=reset?0:page.value
 const queryKey=account+'|'+kind+'|'+nextPage
 if(loading.value&&inFlightQuery===queryKey)return
 const generation=++requestGeneration
 inFlightQuery=queryKey
 loading.value=true
 if(!preserveFeedback){error.value='';message.value=''}
 try{
  const url='/api/approvals?page='+nextPage+
   (kind?'&status='+encodeURIComponent(kind):'')
  const result=await getJson(url)
  if(ticket!==epoch||generation!==requestGeneration||!props.active||
   account!==props.userId||kind!==filter.value)return
  items.value=Array.isArray(result.items)?result.items:[]
  selectedIds.value=[]
  page.value=nextPage
  hasMore.value=result.has_more===true
 }catch(e){
  if(ticket===epoch&&generation===requestGeneration)
   error.value=(e as Error).message
 }finally{
  if(ticket===epoch&&generation===requestGeneration){
   loading.value=false
   inFlightQuery=''
  }
 }
}
async function toggle(){
 expanded.value=!expanded.value
 if(expanded.value)await load(true)
}
// Refresh once on foreground return, not via frequent D1 polling.
function refreshOnReturn(){
 if(document.visibilityState==='visible'&&available.value&&expanded.value&&
   !loading.value&&!busyId.value)void load(true)
}
onMounted(()=>{
 document.addEventListener('visibilitychange',refreshOnReturn)
 window.addEventListener('pageshow',refreshOnReturn)
})
onUnmounted(()=>{
 document.removeEventListener('visibilitychange',refreshOnReturn)
 window.removeEventListener('pageshow',refreshOnReturn)
})
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
// A review is not an execution: only wired, journal-backed operations get a button.
// Non-cash finance and document homeflow/study remain non-executable.
function isSupportedExecution(item:Approval){
  const cash=item.source_app==='kakebo'&&item.target_app==='kakebo'&&
   item.operation==='finance.entry.create'&&item.resource_type==='finance_entry'
  const documentFinance=item.source_app==='jp-document-assistant'&&
   item.target_app==='kakebo'&&item.operation==='document.sync.finance'&&
   item.resource_type==='document_sync_candidate'&&documentExecutionEnabled.value
  const sharedEntry=item.source_app==='kakebo'&&item.target_app==='kakebo'&&
   item.resource_type==='shared_entry_mutation'&&
   ['finance.entry.create','finance.entry.update','finance.entry.delete',
    'finance.entry.restore'].includes(item.operation)&&sharedEntryExecutionEnabled.value
  return cash||sharedEntry||documentFinance
 }
function canExecute(item:Approval){
 return props.isOwner&&executionEnabled.value&&isSupportedExecution(item)&&
  (item.status==='approved'||item.status==='failed_retryable')
}
function statusLabel(item:Approval){
 if(item.status==='approved')return isSupportedExecution(item)
  ?'已批准 · 自动核对中':'已批准 · 待目标处理'
 return statusNames[item.status]||'处理中'
}

function isSharedReview(item:Approval){
 return item.source_app==='kakebo'&&item.target_app==='kakebo'&&
 item.resource_type==='shared_entry_mutation'&&
 ['finance.entry.create','finance.entry.update','finance.entry.delete',
  'finance.entry.restore'].includes(item.operation)
}
async function reviewSummary(item:Approval){
 if(!isSharedReview(item))throw Error('该申请缺少安全的明细核对通道，请逐笔审核')
 const detail=await getJson('/api/approvals/'+encodeURIComponent(item.request_id)+'/detail')
 if(detail.ok!==true||detail.approval_id!==item.request_id||
  !detail.entry&&!detail.before)throw Error('明细核对失败，不能批准')
 const x=detail.entry||detail.before
 return String(x.date||'')+' · '+(x.type==='income'?'收入':x.type==='expense'?'支出':'资产转移')+
  ' · ¥'+Number(x.amount||0).toLocaleString('ja-JP')+
  ' · '+String(x.category||'')+' · '+String(x.merchant||'')+
  (x.type==='expense'?' · 支付方式：'+String(x.payment_source||'現金'):'')+
  (x.note?' · 备注：'+String(x.note).slice(0,80):'')
}
const selectedApprovals=computed(()=>items.value.filter(x=>
 selectedIds.value.includes(x.request_id)&&x.status==='pending'&&Number.isSafeInteger(x.version)))
const selectedExecutions=computed(()=>items.value.filter(x=>
 selectedExecutionIds.value.includes(x.request_id)&&canExecute(x)))
function toggleExecutionSelected(item:Approval){
 if(!canExecute(item)||loading.value||busyId.value)return
 selectedExecutionIds.value=selectedExecutionIds.value.includes(item.request_id)
  ?selectedExecutionIds.value.filter(id=>id!==item.request_id)
  :selectedExecutionIds.value.length<10?[...selectedExecutionIds.value,item.request_id]
  :selectedExecutionIds.value
}
async function runSelectedExecutions(){
 if(!available.value||!props.isOwner||!executionEnabled.value||busyId.value||
    loading.value||selectedExecutions.value.length<1||
    selectedExecutions.value.length>10)return
 const actor=props.userId,ticket=epoch
 const selected=selectedExecutions.value.map(x=>({id:x.request_id,status:x.status,version:x.version}))
 if(!await confirmAction({
  title:'逐项执行已批准账务',confirmLabel:'逐项执行',
  message:'最多 10 笔将按顺序独立执行。每笔使用原审批 ID，逐项取得实际账本回执；不是跨数据库原子批量事务。一旦有失败或结果不明，立即停止，不会自动重试。',
 }))return
 if(ticket!==epoch||actor!==props.userId||!props.active||
   selected.some(p=>!items.value.some(x=>x.request_id===p.id&&
      x.status===p.status&&x.version===p.version&&canExecute(x))))return
 busyId.value='batch-execute';error.value='';message.value=''
 const result=await executeApprovedBatch(selected.map(x=>x.id),async id=>{
  const receipt=await getJson('/api/approvals/'+id+'/execute',{
   method:'POST',headers:{'content-type':'application/json'},body:'{}'
  })
  return {ok:receipt.ok,applied:receipt.applied,status:receipt.status,
   approval_id:receipt.approval_id,remote_id:receipt.remote_id}
 },()=>ticket===epoch&&actor===props.userId&&props.active)
 if(ticket!==epoch||actor!==props.userId||!props.active)return
 selectedExecutionIds.value=[]
 if(result.ok){
  message.value='已逐项确认 '+result.applied.length+' 笔真实目标入账回执；每笔各自独立提交。'
 }else{
  error.value='已确认 '+result.applied.length+' 笔；停在原审批 '+String(result.stopped_at||'').slice(0,8)+
   '（'+result.code+'）。后续未执行；请核对原审批 ID，不要创建重复财务申请。'
 }
 busyId.value=''
 await load(true,true)
}

function toggleBatchSelected(item:Approval){
 if(!props.isOwner||!batchReviewEnabled.value||item.status!=='pending'||
  unconfirmedBatch.value||busyId.value||loading.value)return
 selectedIds.value=selectedIds.value.includes(item.request_id)
  ?selectedIds.value.filter(id=>id!==item.request_id)
  :selectedIds.value.length<20?[...selectedIds.value,item.request_id]:selectedIds.value
}
async function reconcileBatch(){
 const saved=unconfirmedBatch.value
 if(!saved||!available.value||!props.isOwner||!props.active||busyId.value)return
 const current=props.userId,token=epoch
 busyId.value='batch-reconcile';error.value=''
 try{
  const receipt=await getJson('/api/approvals/batch-review/'+saved.batch_id)
  if(token!==epoch||props.userId!==current||!props.active)return
  if(receipt.reviewed===true&&receipt.applied===false){
   unconfirmedBatch.value=null;selectedIds.value=[]
   message.value='批量审核已经记录，目标应用尚未执行。'
  }else error.value='审核回执不一致，须人工核对同一批次 ID。'
 }catch{
  if(token===epoch&&props.userId===current)
   error.value='批量审核结果尚未确认。保留原批次 ID，不要重复创建新批次。'
 }finally{
  if(token===epoch&&props.userId===current){busyId.value='';await load(true,true)}
 }
}
async function reviewBatch(decision:'approve'|'reject'){
 if(!batchReviewEnabled.value||!props.isOwner||!available.value||!props.active||
  !!busyId.value||loading.value||unconfirmedBatch.value)return
 const selected=selectedApprovals.value
 if(selected.length===0||selected.length>20)return
 const current=props.userId,token=epoch
 const ids=selected.map(x=>({request_id:x.request_id,expected_version:x.version}))
 const label=decision==='approve'?'批准':'拒绝'
 let summaries:string[]=[]
 if(decision==='approve'){
  try{for(const item of selected)summaries.push(await reviewSummary(item))}
  catch{error.value='请先确认每一笔的金额、分类和商家；明细读取失败时不能批量批准。';return}
 }
 if(!await confirmAction({title:'批量'+label+'家庭申请',confirmLabel:'确认'+label,
  message:'本次审核'+selected.length+'笔申请。'+
   (decision==='approve'?'审核通过后立即尝试逐笔入账；结果不明时保留原申请自动核对。':'拒绝后不会入账。')+
   (summaries.length?'\n'+summaries.map((x,i)=>(i+1)+'. '+x).join('\n'):''),
  ...(decision==='reject'?{danger:true}:{})}))return
 if(token!==epoch||current!==props.userId||!props.active||
  ids.some(p=>!items.value.some(item=>item.request_id===p.request_id&&
    item.version===p.expected_version&&item.status==='pending')))return
 const payload:BatchRequest={batch_id:crypto.randomUUID(),decision,expected_user_id:current,items:ids}
 unconfirmedBatch.value=payload;busyId.value='batch-review';error.value='';message.value=''
 try{
  const result=await getJson('/api/approvals/batch-review',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
  if(token!==epoch||props.userId!==current||!props.active)return
  if(result.reviewed!==true||result.applied!==false||result.count!==ids.length){
   error.value='服务器回执不完整，请使用原批次 ID 核对。';return
  }
  unconfirmedBatch.value=null;selectedIds.value=[]
  message.value='已批量'+label+' '+ids.length+' 笔'+
   (decision==='approve'?'，正使用原审批编号逐笔核对入账':'，不会入账')
  if(decision==='approve'){
   const execution=await executeApprovedBatch(ids.map(x=>x.request_id),async approvalId=>{
    const receipt=await getJson('/api/approvals/'+approvalId+'/execute',{
     method:'POST',headers:{'content-type':'application/json'},body:'{}'})
    return {ok:receipt.ok,applied:receipt.applied,status:receipt.status,
     approval_id:receipt.approval_id,remote_id:receipt.remote_id}
   },()=>token===epoch&&current===props.userId&&props.active,20)
   if(!execution.ok)
    message.value='审批已通过，已入账 '+execution.applied.length+
     ' 笔。其余将按原审批编号自动核对，不需要再次批准。'
   else message.value='已批准并入账 '+execution.applied.length+' 笔'
  }
 }catch{
  if(token===epoch&&props.userId===current)
   error.value='批量审核结果不确定。请使用“核对原批次”查看，不要新建另一批。'
 }finally{
  if(token===epoch&&props.userId===current){busyId.value='';await load(true,true)}
 }
}

async function act(item:Approval,kind:'approve'|'reject'|'execute'|'cancel'){
 const allowed=kind==='cancel'
  ?!props.isOwner&&item.requester_user_id===props.userId&&item.status==='pending'
  :props.isOwner&&(kind==='execute'
   ?canExecute(item):item.status==='pending')
 if(busyId.value||loading.value||!available.value||!allowed)return
 const id=item.request_id,account=props.userId
 const chosenStatus=item.status
 let summary=''
 if(['approve','reject'].includes(kind)&&isSharedReview(item)){
  try{summary='\n申请明细：'+await reviewSummary(item)}
  catch{error.value='该家庭账务的金额、分类和商家暂不能核对，不能盲目审批。';return}
 }
 const options=kind==='execute'
  ?item.status==='failed_retryable'
   ?{title:'核对后重试原审批',confirmLabel:'确认安全重试',
     message:'上次执行结果尚未确认。系统将使用同一审批 ID 与家計簿的幂等记录核对结果；不会创建新的审批或重复入账。'}
   :{title:'执行已批准账务',confirmLabel:'确认执行',
     message:'系统会再次核实批准记录，并由家計簿实际入账。同一审批只能入账一次。'}
  :kind==='approve'
   ?{title:'批准家庭申请',confirmLabel:'确认批准',
     message:'批准后会自动尝试入账，失败时系统会使用原审批 ID 核对，无需再次批准。'}
   :kind==='cancel'
    ?{title:'撤回家庭申请',confirmLabel:'确认撤回',
      message:'只有待审批申请可以撤回，撤回后管理员不能再批准。'}
    :{title:'拒绝家庭申请',confirmLabel:'确认拒绝',
      message:'拒绝后不会修改家庭正式账本。',danger:true}
 options.message+=summary
 if(!await confirmAction(options))return
 if(account!==props.userId||!props.active)return
 // Never execute an item whose status moved while confirmation was open.
 if(item.status!==chosenStatus||
   (kind==='cancel'&&(props.isOwner||item.requester_user_id!==props.userId))||
   (kind!=='cancel'&&!props.isOwner))return
 busyId.value=id;error.value='';message.value=''
 try{
  const path=kind==='execute'?'/api/approvals/'+id+'/execute':
   kind==='cancel'?'/api/approvals/'+id+'/cancel':
   '/api/approvals/'+id+'/review'
  const payload=kind==='execute'||kind==='cancel'?{}:{decision:kind}
  const result=await getJson(path,{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify(payload)})
  if(account!==props.userId||!props.active)return
  if(kind==='approve'&&item.resource_type==='shared_entry_mutation'&&
    item.source_app==='kakebo'&&item.target_app==='kakebo'){
    // Review first, execute only the SAME immutable approval. Rejections
    // never call the ledger. A failed execute stays approved for safe retry.
    if(result.request?.request_id!==id||result.request?.status!=='approved')
     throw Error('承認状態を確認できません')
    if(!executionEnabled.value||!sharedEntryExecutionEnabled.value){
     message.value='已批准，执行服务暂不可用；明细仍是灰色待入账'
    }else{
     try{
      const receipt=await getJson('/api/approvals/'+id+'/execute',{
       method:'POST',headers:{'content-type':'application/json'},body:'{}'})
      if(receipt.applied!==true||receipt.approval_id!==id)
       throw Error('入账回执尚未确认')
      message.value='已批准并成功入账，家計簿明细恢复正常'
     }catch(executionError){
      message.value='已批准，系统将自动核对原申请，无需重复批准'
      error.value='家計簿入账结果尚未确认；系统会安全核对，不要新建重复账单。'
     }
    }
   }else message.value=kind==='approve'?'已批准，正在核对入账':
    kind==='reject'?'已拒绝，不会入账':
    kind==='cancel'?'已撤回，无法再批准':
    result.applied===true?'已执行并入账':'执行结果待核对'
 }catch(e){
  if(account===props.userId){
   const reason=(e as Error).message
   error.value=kind==='execute'&&reason==='expired_receipt_unknown'
    ?'审批已过期，暂未查到确定的入账回执。可再次核对原审批；系统不会重新入账。'
    :kind==='execute'&&[
    'target_conflict_unconfirmed_safe_to_retry',
    'target_result_unknown_safe_to_retry',
    'receipt_reconciliation_required',
    'applied_remote_receipt_pending_reconciliation'
   ].includes(reason)
    ?'家計簿的执行结果尚未确认。请核对原审批后通过“安全重试”对账，不要新建申请。'
    :reason
  }
 }finally{
  // Keep an action's visible success OR failure message while refreshing the
  // authoritative state. Previously load(true) erased it immediately.
  if(account===props.userId){busyId.value='';await load(true,true)}
 }
}
</script>

<template>
 <section v-if="available" class="panel approval-center" :class="{'approval-compact':compact}" aria-label="家庭审批中心">
  <div v-if="!compact" class="approval-head">
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
   <div v-if="isOwner&&batchReviewEnabled" class="approval-batch-toolbar">
    <span>已选 {{ selectedApprovals.length }} 笔 · 仅审核，暂不入账</span>
    <button v-if="unconfirmedBatch" type="button" class="outline"
     :disabled="!!busyId||loading" @click="reconcileBatch">核对原批次</button>
    <template v-else>
     <button type="button" class="outline" :disabled="!!busyId||loading||!selectedApprovals.length"
      @click="reviewBatch('reject')">批量拒绝</button>
     <button type="button" class="primary" :disabled="!!busyId||loading||!selectedApprovals.length"
      @click="reviewBatch('approve')">批量批准</button>
    </template>
   </div>
   <div v-if="isOwner&&executionEnabled" class="approval-batch-toolbar">
    <span>已选 {{selectedExecutions.length}} 笔 · 按原 ID 逐笔实际入账 · 非跨库原子事务</span>
    <button type="button" class="primary" :disabled="!!busyId||loading||!selectedExecutions.length"
     @click="runSelectedExecutions">逐项执行（最多 10 笔）</button>
   </div>
   <p v-if="error" class="approval-error" role="alert">{{ error }}</p>
   <p v-if="message" class="approval-feedback" role="status">{{ message }}</p>
   <p v-if="loading" class="approval-empty" role="status">读取中…</p>
   <p v-else-if="items.length===0" class="approval-empty">暂无申请</p>
   <ul v-else class="approval-list">
    <li v-for="item in items" :key="item.request_id" class="approval-item">
     <div class="approval-titleline">
      <label v-if="canExecute(item)" class="approval-batch-check">
       <input type="checkbox" :checked="selectedExecutionIds.includes(item.request_id)"
        :disabled="!!busyId||loading" @change="toggleExecutionSelected(item)"/>
       <span>选择执行</span>
      </label>
      <label v-if="isOwner&&batchReviewEnabled&&item.status==='pending'" class="approval-batch-check">
       <input type="checkbox" :checked="selectedIds.includes(item.request_id)"
        :disabled="!!busyId||loading||!!unconfirmedBatch"
        @change="toggleBatchSelected(item)"/>
       <span>选择</span>
      </label>
      <b>{{ actionNames[item.operation]||'家庭操作申请' }}</b>
      <span class="approval-state" :data-status="item.status">
       {{ statusLabel(item) }}
      </span>
     </div>
     <div class="approval-meta">
      <span>{{ person(item.requester_user_id) }}</span>
      <span>{{ time(item.created_at) }}</span>
     </div>
     <p v-if="item.status==='approved'" class="approval-note">
      {{ isSupportedExecution(item)
       ?'已批准，系统会自动核对入账；目前尚未确认正式入账。'
       :'已批准，但当前尚无此操作的安全执行器；目标应用未发生更改。' }}
     </p>
     <p v-else-if="item.status==='failed_retryable'" class="approval-note">
      入账结果尚未确认，系统会自动核对原审批 ID；请勿重复记账。
     </p>
     <div v-if="!isOwner&&item.requester_user_id===userId&&item.status==='pending'"
       class="approval-actions">
      <button class="outline" type="button" :disabled="!!busyId||loading"
       @click="act(item,'cancel')">撤回申请</button>
     </div>
     <div v-else-if="isOwner&&item.status==='pending'" class="approval-actions">
      <button class="outline" type="button" :disabled="!!busyId||loading"
       @click="act(item,'reject')">拒绝</button>
      <button class="primary" type="button" :disabled="!!busyId||loading"
       @click="act(item,'approve')">批准</button>
     </div>
     <div v-else-if="canExecute(item)"
       class="approval-actions">
      <button class="primary" type="button" :disabled="!!busyId||loading"
       @click="act(item,'execute')">{{ item.status==='failed_retryable'?'安全重试':'执行入账' }}</button>
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
.approval-compact{border:0!important;box-shadow:none!important;padding:0!important;background:transparent!important}
.approval-batch-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.approval-batch-toolbar span{font-size:12px;color:var(--ui-muted);margin-right:auto}
.approval-batch-toolbar button{min-height:44px}
.approval-batch-check{display:inline-flex;align-items:center;gap:5px;font-size:12px;flex:none}
.approval-batch-check input{width:19px;height:19px}
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
