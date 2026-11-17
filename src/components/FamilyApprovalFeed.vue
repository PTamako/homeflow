<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ApprovalCenter from './ApprovalCenter.vue'
import SwipeActions from './SwipeActions.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'
import {createConditionalApprovalPoller,needsApprovalReconciliation} from '../approval-reconciliation-polling.mjs'

type Kind='approval'|'recurring'|'consent'
type Item={
 kind:Kind;id:string;actor_user_id:string;recipient_user_id:string|null
 owner_authorizer_user_id:string|null;status:string;created_at:number
 expires_at:number;version:number;operation:string|null;source_app:string|null
 resource_type:string|null;plan_type:string|null;amount_jpy:number|null
 due_day:number|null;start_month:string|null;end_month:string|null
}
const props=defineProps<{
 active:boolean;userId:string;isOwner:boolean
 members?:Array<{id:string;loginName:string}>
 profiles?:Array<{memberUserId:string|null;displayName:string}>
}>()
const rows=ref<Item[]>([]),page=ref(0),hasMore=ref(false)
const loading=ref(false),busy=ref(''),error=ref(''),message=ref('')
const batchOpen=ref(false)
const details=ref<Record<string,{entry:Record<string,unknown>|null;before:Record<string,unknown>|null}>>({})
const detailBusy=ref<Record<string,boolean>>({}),detailError=ref<Record<string,boolean>>({})
const detailSheetRow=ref<Item|null>(null)
const detailRequests=new Map<string,Promise<boolean>>()
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
let revision=0
const pageSize=5
const operationLabels:Record<string,string>={
 'finance.entry.create':'新增家庭账务',
 'finance.entry.update':'修改家庭账务',
 'finance.entry.delete':'删除家庭账务',
 'finance.entry.restore':'恢复家庭账务',
 'finance.account.public_rule.change':'调整家庭财务规则',
 'finance.credit_card.purchase':'信用卡消费',
 'finance.prepaid.spend':'储值卡消费',
 'finance.points.transfer_out':'积分转移',
 'finance.points.exchange_out':'积分兑换',
 'document.sync.finance':'文书同步到账本',
 'document.sync.homeflow':'文书同步到家庭',
 'document.sync.study':'文书同步到知学',
 'homeflow.shared_task.create':'创建家庭待办'
}
const states:Record<string,string>={
 pending:'待审批',approved:'已批准 · 自动入账中',rejected:'已拒绝',cancelled:'已撤回',
 executing:'入账处理中',applied:'已入账',failed_retryable:'自动核对中',
 failed_final:'执行失败',expired:'已过期',conflict:'状态冲突',
 pending_owner:'待首次批准',revoked:'授权已撤销',
 awaiting_recipient:'待收款人确认',recipient_accepted:'待管理员授权',
 owner_authorized:'已授权 · 未记账',recipient_rejected:'收款人已拒绝'
}
const actionLabels:Record<string,string>={
 approve:'批准',reject:'拒绝',execute:'核对原申请',accept:'确认接收',authorize:'授权',
 revoke:'撤销授权'
}
function person(id:string|null){
 if(!id)return '家庭成员'
 return props.profiles?.find(x=>x.memberUserId===id)?.displayName||
 props.members?.find(x=>x.id===id)?.loginName||
 (id===props.userId?'我':'家庭成员')
}
function title(row:Item){
 if(row.kind==='recurring')return row.plan_type==='sbi_tsumitate'?'SBI 定投计划':'固定费用计划'
 if(row.kind==='consent')return '跨成员转账'
 return operationLabels[row.operation||'']||'家庭操作申请'
}
function description(row:Item){
 if(row.kind==='recurring'){
  const amount=new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',
   maximumFractionDigits:0}).format(row.amount_jpy||0)
  return amount+'/月 · 每月 '+row.due_day+' 日 · '+row.start_month+'～'+row.end_month
 }
 if(row.kind==='consent')return person(row.actor_user_id)+' → '+person(row.recipient_user_id)
 return person(row.actor_user_id)+' · '+new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit'
 }).format(new Date(row.created_at))
}
// All owner-reviewed household ledger mutations share the same source-detail,
// signed execution and status-reconciliation workflow. No personal asset actions.
function isSharedLedger(row:Item){
 if(row.kind!=='approval')return false
 if(row.source_app==='kakebo')return (
  (row.resource_type==='shared_entry_mutation'&&
   ['finance.entry.create','finance.entry.update','finance.entry.delete',
    'finance.entry.restore'].includes(row.operation||''))||
  (row.resource_type==='finance_entry'&&row.operation==='finance.entry.create')||
  (row.resource_type==='credit_card_purchase'&&row.operation==='finance.credit_card.purchase')||
  (row.resource_type==='prepaid_action'&&row.operation==='finance.prepaid.spend'))
 return row.source_app==='jp-document-assistant'&&
  row.resource_type==='document_sync_candidate'&&row.operation==='document.sync.finance'
}
function canDismiss(row:Item){
 const applied=row.status==='applied'
 if(!props.isOwner||row.kind!=='approval'||!applied)return false
 // Keep in sync with ownerReviewAllowed and the D1 dismissal trigger.
 if(row.source_app==='kakebo')return isSharedLedger(row)||
  (row.resource_type==='finance_entry'&&row.operation==='finance.entry.create')||
  (row.resource_type==='credit_card_purchase'&&row.operation==='finance.credit_card.purchase')||
  (row.resource_type==='prepaid_action'&&row.operation==='finance.prepaid.spend')
 return row.source_app==='jp-document-assistant'&&
  row.resource_type==='document_sync_candidate'&&row.operation==='document.sync.finance'
}
function formatMoney(amount:unknown){return Number.isFinite(Number(amount))?'¥'+Number(amount).toLocaleString('ja-JP'):'—'}
function prettyType(type:unknown){return type==='income'?'收入':type==='expense'?'支出':type==='transfer'?'资产转移':'—'}
function previewValues(data:Record<string,unknown>|null){
 if(!data)return []
 return [
  ['日期',String(data.date||'—')+(data.time?' '+data.time:'')],
  ['类型',prettyType(data.type)],['金额',formatMoney(data.amount)],
  ['分类',String(data.category||'—')],['商家',String(data.merchant||'—')],
  ['备注',String(data.note||'无')],
  ...(data.type==='expense'?[['支付方式',String(data.payment_source||'現金')]]:[])
 ]
}
async function ensureDetail(row:Item){
 if(!isSharedLedger(row))return true
 if(details.value[row.id])return true
 if(detailRequests.has(row.id))return detailRequests.get(row.id)!
 const actor=props.userId,householdRevision=revision
 const task=(async()=>{
  detailBusy.value={...detailBusy.value,[row.id]:true}
  try{
   const response=await fetch('/api/approvals/'+encodeURIComponent(row.id)+'/detail',{
    credentials:'same-origin',cache:'no-store'})
   const body=await response.json().catch(()=>({}))
   if(!response.ok||body.ok!==true||body.approval_id!==row.id||
      !body.entry&&!body.before)throw Error('detail_unavailable')
   if(actor!==props.userId||!props.active||!props.isOwner)return false
   details.value={...details.value,[row.id]:{entry:body.entry||null,before:body.before||null}}
   const remaining={...detailError.value};delete remaining[row.id];detailError.value=remaining
   return true
  }catch{
   if(actor===props.userId)detailError.value={...detailError.value,[row.id]:true}
   return false
  }finally{
   if(actor===props.userId)detailBusy.value={...detailBusy.value,[row.id]:false}
  }
 })()
 detailRequests.set(row.id,task)
 try{return await task}finally{detailRequests.delete(row.id)}
}
async function openDetail(row:Item){
 if(!props.active||!props.isOwner||!isSharedLedger(row))return
 detailSheetRow.value=row
 await ensureDetail(row)
}
function actions(row:Item){
 if(row.expires_at<=Date.now()&&
  ['pending','pending_owner','awaiting_recipient','recipient_accepted'].includes(row.status))return []
 if(row.kind==='approval')return row.status==='pending'&&row.actor_user_id!==props.userId?
  ['reject','approve']:isSharedLedger(row)&&['approved','failed_retryable'].includes(row.status)?
  ['execute']:[]
 if(row.kind==='recurring')return row.status==='pending_owner'?
  ['reject','approve']:row.status==='approved'?['revoke']:[]
 if(row.status==='awaiting_recipient'&&row.recipient_user_id===props.userId)
  return ['reject','accept']
 if(row.status==='recipient_accepted')return ['authorize']
 if(row.status==='owner_authorized'&&
  (row.recipient_user_id===props.userId||row.owner_authorizer_user_id===props.userId))
  return ['revoke']
 return []
}
function reset(){
 revision++;rows.value=[];page.value=0;hasMore.value=false
 loading.value=false;busy.value='';error.value='';message.value=''
 batchOpen.value=false;details.value={};detailBusy.value={};detailError.value={};
 detailSheetRow.value=null;detailRequests.clear();cancelConfirm()
}
async function load(n=page.value,preserveMessage=false){
 if(!props.active||!props.isOwner||!props.userId||busy.value)return
 const current=++revision,identity=props.userId
 loading.value=true
 if(!preserveMessage){error.value='';message.value=''}
 try{
  const response=await fetch('/api/household-approvals?page='+n,{
   credentials:'same-origin',cache:'no-store'})
  const data=await response.json().catch(()=>({}))
  if(current!==revision||identity!==props.userId||!props.isOwner||!props.active)return
  if(!response.ok||data.ok!==true||!Array.isArray(data.items)||
   data.page_size!==pageSize||data.items.length>pageSize)
   throw Error(String(data.error||'家庭审批列表读取失败'))
  rows.value=data.items
  page.value=n;hasMore.value=data.has_more===true
  // Five rows at most. Preview is read-only and owner-scoped; never block
  // rendering the whole list while the target sealed intent is fetched.
  for(const row of data.items)if(isSharedLedger(row)&&row.status==='pending')
   void ensureDetail(row)
 }catch(e){
  if(current===revision&&identity===props.userId){
   error.value=(e as Error).message;rows.value=[];hasMore.value=false
  }
 }finally{if(current===revision)loading.value=false}
}
function changePage(delta:number){
 if(loading.value||busy.value||(delta>0&&!hasMore.value)||
  (delta<0&&page.value===0))return
 detailSheetRow.value=null
 void load(page.value+delta)
}
async function act(row:Item,decision:string){
 if(!props.active||!props.isOwner||busy.value||loading.value||
  !actions(row).includes(decision))return
 const actor=props.userId,step=revision
 // Do not approve blind: the original sealed entry must be readable first.
 if(isSharedLedger(row)&&['approve','reject'].includes(decision)){
  const ready=await ensureDetail(row)
  if(!ready){error.value='账务明细暂时无法核对，为安全起见不能批准或拒绝。';return}
 }
 const phrase=actionLabels[decision]||decision
 const caution=isSharedLedger(row)&&decision==='approve'
  ?'批准后系统会使用原审批编号安全入账；失败时仍保留待入账状态供重试。拒绝不会改动账本。'
  :isSharedLedger(row)&&decision==='execute'
  ?'先查询原申请入账回执；仅在确实未执行时使用同一个审批编号安全重试，不会生成重复账目。'
  :row.kind==='recurring'&&decision==='approve'
  ?'仅批准这项计划一次，约定条件和有效期不变时无需逐月重新批准。每期仍须以真实交易凭证独立入账。'
  :row.kind==='consent'
   ?'该操作只记录独立同意或授权，不会自动向银行转账，也不会直接写入家計簿。'
   :'审核决定与实际入账是两步；批准后仍需通过原审批的安全执行流程核对入账。'
 const data=details.value[row.id]?.entry||details.value[row.id]?.before
 const summary=isSharedLedger(row)&&data?
  '\n核对明细：'+String(data.date||'')+' · '+prettyType(data.type)+' · '+
  formatMoney(data.amount)+' · '+String(data.category||'')+' · '+String(data.merchant||'')+
  (data.type==='expense'?' · 支付：'+String(data.payment_source||'現金'):'')+
  (data.note?'\n备注：'+String(data.note).slice(0,200):''):''
 if(!await confirmAction({title:phrase+title(row),confirmLabel:'确认'+phrase,
  message:caution+summary,...(decision==='reject'||decision==='revoke'?{danger:true}:{})}))return
 if(step!==revision||actor!==props.userId||!props.active||!props.isOwner||
  !rows.value.some(item=>item.kind===row.kind&&item.id===row.id&&
   item.version===row.version&&item.status===row.status))return
 let path='',body:Record<string,string|number>={}
 if(row.kind==='approval'){
  path='/api/approvals/'+encodeURIComponent(row.id)+
   (decision==='execute'?'/execute':'/review')
  body=decision==='execute'?{}:{decision}
 }else if(row.kind==='recurring'){
  path='/api/recurring-finance/policies/'+encodeURIComponent(row.id)+
   (decision==='revoke'?'/revoke':'/review')
  body={expected_user_id:actor,expected_version:row.version,
   ...(decision==='revoke'?{}:{decision})}
 }else{
  const event=decision==='accept'||decision==='reject'?'recipient':decision
  path='/api/finance-cross-member/consents/'+encodeURIComponent(row.id)+'/'+event
  body={expected_user_id:actor,expected_version:row.version,
   ...(event==='recipient'?{decision}:{})}
 }
 busy.value=row.kind+':'+row.id;error.value='';message.value=''
 try{
  const response=await fetch(path,{method:'POST',cache:'no-store',
   credentials:'same-origin',headers:{'content-type':'application/json'},
   body:JSON.stringify(body)})
  const result=await response.json().catch(()=>({}))
  if(actor!==props.userId||!props.active||!props.isOwner)return
  if(!response.ok||
   (row.kind==='approval'?(decision==='execute'?
     result.applied!==true||result.approval_id!==row.id:
     !result.request||result.request.request_id!==row.id):
    row.kind==='recurring'?result.ok!==true||result.policy?.policy_id!==row.id||
     result.policy?.ledger_applied!==false:
     result.ok!==true||result.consent?.consent_id!==row.id||
     result.consent?.ledger_applied!==false||result.consent?.execution_permitted!==false))
   throw Error(String(result.error||result.code||'操作结果未确认，请核对原申请'))
  if(isSharedLedger(row)&&decision==='approve'){
   if(result.request?.status!=='approved')throw Error('批准结果尚未确认')
   // Owner's one approval tap triggers the existing idempotent execution API.
   // An unsuccessful execution leaves the request approved, never fabricates an entry.
   try{
    const applied=await fetch('/api/approvals/'+encodeURIComponent(row.id)+'/execute',{
     method:'POST',cache:'no-store',credentials:'same-origin',
     headers:{'content-type':'application/json'},body:'{}'})
    const receipt=await applied.json().catch(()=>({}))
    if(!applied.ok||receipt.applied!==true||receipt.approval_id!==row.id)
     throw Error(String(receipt.code||receipt.error||'家計簿入账回执未确认'))
    message.value='已批准并成功入账；明细不再显示灰色'
   }catch(e){
    message.value='已批准，系统会自动核对并补入账，无需再次批准'
    error.value='家計簿尚未确认入账结果。请勿重复记账，系统会自动核对原申请。'
   }
  }else message.value=decision==='execute'?'原申请已确认入账':phrase+'已登记'+
   (decision==='approve'&&isSharedLedger(row)?'，正在自动核对入账':'')
 }catch(e){if(actor===props.userId)error.value=
   row.kind==='approval'?'操作结果尚未确认，请刷新查看原申请；不要重复提交。':(e as Error).message}
 finally{if(actor===props.userId){busy.value='';await load(page.value,true)}}
}
// Do not poll an idle family approval feed. A new status replaces the last
// response and automatically cancels the timer once every ledger entry settles.
async function dismissHistory(row:Item){
 if(!props.active||!props.isOwner||!canDismiss(row)||loading.value||busy.value)return
 const actor=props.userId,step=revision
 if(!await confirmAction({title:'删除审批记录',confirmLabel:'删除记录',danger:true,
  message:'仅从家庭审批列表隐藏这条已入账记录。记账本里的正式明细不会删除，后台审核与入账记录也会保留。'}))return
 if(step!==revision||actor!==props.userId||!props.active||!props.isOwner||
  !rows.value.some(x=>x.kind===row.kind&&x.id===row.id&&x.status==='applied'))return
 busy.value='dismiss:'+row.id;error.value='';message.value=''
 let dismissed=false
 try{
  const response=await fetch('/api/approvals/'+encodeURIComponent(row.id)+'/history',
   {method:'DELETE',credentials:'same-origin',cache:'no-store'})
  const result=await response.json().catch(()=>({}))
  if(actor!==props.userId||!props.active||!props.isOwner)return
  if(!response.ok||result.ok!==true||result.request_id!==row.id||result.dismissed!==true)
   throw Error(String(result.error||'删除审批记录失败'))
  dismissed=true
  message.value='已从审批列表移除，记账本明细不变'
  if(detailSheetRow.value?.id===row.id)detailSheetRow.value=null
 }catch(e){if(actor===props.userId)error.value=(e as Error).message}
 finally{
  if(actor===props.userId){
   busy.value=''
   if(dismissed){
    await load(page.value,true)
    if(!rows.value.length&&page.value>0&&!error.value)await load(page.value-1,true)
   }
  }
 }
}
const statusPoller=createConditionalApprovalPoller({
 shouldPoll:()=>props.active&&props.isOwner&&!!props.userId&&
  document.visibilityState==='visible'&&!loading.value&&!busy.value&&
  needsApprovalReconciliation(rows.value,row=>row.kind==='approval'&&isSharedLedger(row)),
 onRefresh:()=>load(page.value,true)
})
function foreground(){
 if(document.visibilityState!=='visible'){statusPoller.stop();return}
 if(props.active&&props.isOwner&&!loading.value&&!busy.value)
  void load(page.value,true)
 else statusPoller.sync()
}
watch(()=>[props.active,props.isOwner,props.userId],()=>{
 statusPoller.stop();reset()
 if(props.active&&props.isOwner)void load(0)
},{immediate:true})
watch([rows,loading,busy,()=>props.active,()=>props.isOwner,()=>props.userId],
 ()=>statusPoller.sync(),{flush:'post'})
onMounted(()=>{
 document.addEventListener('visibilitychange',foreground)
 window.addEventListener('pageshow',foreground)
})
onUnmounted(()=>{
 statusPoller.dispose();reset()
 document.removeEventListener('visibilitychange',foreground)
 window.removeEventListener('pageshow',foreground)
})
</script>
<template>
 <section class="panel family-approval-feed" aria-label="家庭审批列表">
  <header class="feed-header">
   <div class="management-section-heading">
    <AppIcon name="clipboard-check" :size="20"/><h2>家庭审批</h2>
   </div>
   <div class="feed-header-actions">
    <button type="button" class="feed-text-button" :disabled="loading||!!busy"
      @click="load(page)">刷新</button>
    <button type="button" class="feed-text-button" @click="batchOpen=true">批量操作</button>
   </div>
  </header>
  <p v-if="error" class="feed-error" role="alert">{{error}}</p>
  <p v-if="message" class="feed-success" role="status">{{message}}</p>
  <p v-if="loading" class="feed-empty" role="status">正在加载…</p>
  <p v-else-if="!rows.length&&!error" class="feed-empty">暂无申请</p>
  <ul v-else-if="rows.length" class="feed-list">
   <li v-for="row in rows" :key="row.kind+':'+row.id" class="feed-item">
    <SwipeActions :id="row.id" scope="family-approval-history" :allow-edit="false"
     :allow-delete="canDismiss(row)" :show-trigger="canDismiss(row)"
     delete-label="删除记录" @delete="dismissHistory(row)">
    <div class="feed-top">
     <b>{{title(row)}}</b>
     <span class="feed-state">{{row.expires_at<=Date.now()&&
      ['pending','pending_owner','awaiting_recipient','recipient_accepted'].includes(row.status)
      ?'已过期':states[row.status]||row.status}}</span>
    </div>
    <div class="feed-meta">
     <p>{{description(row)}}</p>
     <button v-if="isSharedLedger(row)" type="button" class="feed-text-button feed-detail-trigger"
      :aria-label="'查看'+title(row)+'完整明细'"
      @click="openDetail(row)">查看完整明细</button>
    </div>
    <template v-if="isSharedLedger(row)">
     <p v-if="details[row.id]?.entry||details[row.id]?.before" class="ledger-summary">
      {{String((details[row.id].entry||details[row.id].before)?.date||'')}} ·
      {{prettyType((details[row.id].entry||details[row.id].before)?.type)}} ·
      {{formatMoney((details[row.id].entry||details[row.id].before)?.amount)}} ·
      {{String((details[row.id].entry||details[row.id].before)?.merchant||'')}}
     </p>
     <p v-if="detailError[row.id]" class="feed-error">明细暂不可用，无法安全批准。请稍后刷新。</p>
    </template>
    <div v-if="actions(row).length" class="feed-actions">
     <button v-for="decision in actions(row)" :key="decision" type="button"
      :disabled="!!busy||loading||(isSharedLedger(row)&&['approve','reject'].includes(decision)&&!details[row.id])" :class="{primary:decision==='approve'||decision==='accept'||decision==='authorize'}"
      @click="act(row,decision)">{{actionLabels[decision]}}</button>
    </div>
    </SwipeActions>
   </li>
  </ul>
  <nav v-if="rows.length&&(page>0||hasMore)" class="feed-pages" aria-label="家庭审批分页">
   <button type="button" :disabled="page===0||loading||!!busy" @click="changePage(-1)">上一页</button>
   <span>第 {{page+1}} 页 · 每页 5 条</span>
   <button type="button" :disabled="!hasMore||loading||!!busy" @click="changePage(1)">下一页</button>
  </nav>
  <EditBottomSheet v-if="detailSheetRow" :title="title(detailSheetRow)+' · 完整明细'"
   @close="detailSheetRow=null">
   <p v-if="detailBusy[detailSheetRow.id]" class="feed-empty" role="status">正在读取明细…</p>
   <div v-else-if="detailError[detailSheetRow.id]" class="feed-detail-error" role="alert">
    <p>明细暂时无法读取，请重试。无法核对的账务不会允许批准。</p>
    <button type="button" class="feed-detail-retry"
     @click="ensureDetail(detailSheetRow)">重新读取</button>
   </div>
   <div v-else-if="details[detailSheetRow.id]" class="approval-detail">
    <div v-if="details[detailSheetRow.id].before&&detailSheetRow.operation!=='finance.entry.create'">
     <strong>原始明细</strong>
     <dl><template v-for="([key,value],i) in previewValues(details[detailSheetRow.id].before)" :key="'old'+i">
      <dt>{{key}}</dt><dd>{{value}}</dd></template></dl>
    </div>
    <div v-if="details[detailSheetRow.id].entry">
     <strong>{{detailSheetRow.operation==='finance.entry.update'?'拟修改为':'申请明细'}}</strong>
     <dl><template v-for="([key,value],i) in previewValues(details[detailSheetRow.id].entry)" :key="i">
      <dt>{{key}}</dt><dd>{{value}}</dd></template></dl>
    </div>
   </div>
   <p v-else class="feed-empty">暂无可查看的明细</p>
  </EditBottomSheet>
  <EditBottomSheet v-if="batchOpen" title="批量审批与安全执行" @close="batchOpen=false">
   <ApprovalCenter :active="active&&isOwner" :user-id="userId" :is-owner="isOwner"
    :members="members" :profiles="profiles" auto-open compact/>
  </EditBottomSheet>
  <ConfirmActionSheet v-if="confirmRequest" :request="confirmRequest"
   @confirm="acceptConfirm" @cancel="cancelConfirm"/>
 </section>
</template>
<style scoped>
.family-approval-feed{min-width:0}
.feed-header,.feed-header-actions,.feed-top,.feed-pages{display:flex;align-items:center;justify-content:space-between;gap:10px}
.feed-header{margin-bottom:8px}
.feed-header .management-section-heading{min-width:0}
.feed-header-actions{gap:4px}
.feed-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.feed-item .feed-meta p{min-width:0;flex:1;margin:0}
.feed-detail-trigger{flex:none;white-space:nowrap;text-align:right;padding-inline:6px}
.feed-text-button{min-height:44px;border:none;background:transparent;padding:8px;color:#42775c;font-size:12px;font-weight:700}
.feed-list{list-style:none;padding:0;margin:0;display:grid;gap:0}
.feed-item{padding:13px 0;border-top:1px solid #edf1ed;min-width:0;overflow-wrap:anywhere}
.feed-top{align-items:flex-start;gap:8px}
.feed-top b{font-size:14px;min-width:0}
.feed-state{font-size:11px;color:#688374;flex:none;text-align:right;max-width:47%}
.feed-item p{font-size:12px;color:var(--ui-muted,#74847a);line-height:1.55;margin:5px 0 0;overflow-wrap:anywhere}
.feed-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap}
.feed-actions button,.feed-pages button{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid #cadaD0;background:#fff;color:#386f53;font-size:13px;font-weight:700}
.feed-actions button.primary{background:#3d8061;border-color:#3d8061;color:#fff}
.feed-actions button:disabled,.feed-pages button:disabled{opacity:.42}
.feed-empty{padding:18px 0;margin:0;text-align:center;color:#829389;font-size:13px}
.feed-error,.feed-success{font-size:12px;overflow-wrap:anywhere}
.feed-error{color:#b34f45}
.ledger-summary{font-weight:700;color:var(--ui-text,#2f4740)!important}
.approval-detail{padding:12px;border:1px solid #e1eae3;border-radius:10px;background:#f8fbf8;display:grid;gap:14px}
.feed-detail-error{font-size:13px;color:#a44c42}
.feed-detail-retry{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid #cadaD0;background:#fff;color:#386f53;font-weight:700}
.approval-detail strong{font-size:12px}
.approval-detail dl{display:grid;grid-template-columns:64px minmax(0,1fr);gap:4px 8px;margin:7px 0 0;font-size:12px}
.approval-detail dt{color:#74847a}.approval-detail dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.feed-success{color:#317855}
.feed-pages{padding-top:10px;border-top:1px solid #edf1ed}
.feed-pages span{font-size:12px;color:#7a8f80;white-space:nowrap}
@media(max-width:360px){.feed-pages{gap:5px}.feed-pages button{padding:8px}.feed-header-actions{gap:0}}
</style>
