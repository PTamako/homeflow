<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ApprovalCenter from './ApprovalCenter.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'

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
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
let revision=0
const pageSize=5
const operationLabels:Record<string,string>={
 'finance.entry.create':'新增家庭账务',
 'finance.asset_transfer.bank_to_bank':'银行账户资产转移',
 'finance.entry.update':'修改家庭账务',
 'finance.entry.delete':'删除家庭账务',
 'finance.entry.restore':'恢复家庭账务',
 'finance.account.public_rule.change':'调整家庭财务规则',
 'finance.credit_card.purchase':'信用卡消费',
 'finance.credit_card.settlement':'信用卡还款',
 'finance.prepaid.topup':'储值卡充值',
 'finance.prepaid.spend':'储值卡消费',
 'finance.points.transfer_out':'积分转移',
 'finance.points.exchange_out':'积分兑换',
 'finance.sbi_cash.tsumitate':'SBI 定投',
 'finance.sbi_cash.additional':'SBI 追加买付',
 'document.sync.finance':'文书同步到账本',
 'document.sync.homeflow':'文书同步到家庭',
 'document.sync.study':'文书同步到知学',
 'homeflow.shared_task.create':'创建家庭待办'
}
const states:Record<string,string>={
 pending:'待审批',approved:'已批准 · 待执行',rejected:'已拒绝',cancelled:'已撤回',
 executing:'执行中',applied:'已入账',failed_retryable:'待核对重试',
 failed_final:'执行失败',expired:'已过期',conflict:'状态冲突',
 pending_owner:'待首次批准',revoked:'授权已撤销',
 awaiting_recipient:'待收款人确认',recipient_accepted:'待管理员授权',
 owner_authorized:'已授权 · 未记账',recipient_rejected:'收款人已拒绝'
}
const actionLabels:Record<string,string>={
 approve:'批准',reject:'拒绝',accept:'确认接收',authorize:'授权',
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
function actions(row:Item){
 if(row.expires_at<=Date.now()&&
  ['pending','pending_owner','awaiting_recipient','recipient_accepted'].includes(row.status))return []
 if(row.kind==='approval')return row.status==='pending'&&row.actor_user_id!==props.userId?
  ['reject','approve']:[]
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
 batchOpen.value=false;cancelConfirm()
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
 }catch(e){
  if(current===revision&&identity===props.userId){
   error.value=(e as Error).message;rows.value=[];hasMore.value=false
  }
 }finally{if(current===revision)loading.value=false}
}
function changePage(delta:number){
 if(loading.value||busy.value||(delta>0&&!hasMore.value)||
  (delta<0&&page.value===0))return
 void load(page.value+delta)
}
async function act(row:Item,decision:string){
 if(!props.active||!props.isOwner||busy.value||loading.value||
  !actions(row).includes(decision))return
 const actor=props.userId,step=revision
 const phrase=actionLabels[decision]||decision
 const caution=row.kind==='recurring'&&decision==='approve'
  ?'仅批准这项计划一次，约定条件和有效期不变时无需逐月重新批准。每期仍须以真实交易凭证独立入账。'
  :row.kind==='consent'
   ?'该操作只记录独立同意或授权，不会自动向银行转账，也不会直接写入家計簿。'
   :'审核决定与实际入账是两步；批准后仍需通过原审批的安全执行流程核对入账。'
 if(!await confirmAction({title:phrase+title(row),confirmLabel:'确认'+phrase,
  message:caution,...(decision==='reject'||decision==='revoke'?{danger:true}:{})}))return
 if(step!==revision||actor!==props.userId||!props.active||!props.isOwner||
  !rows.value.some(item=>item.kind===row.kind&&item.id===row.id&&
   item.version===row.version&&item.status===row.status))return
 let path='',body:Record<string,string|number>={}
 if(row.kind==='approval'){
  path='/api/approvals/'+encodeURIComponent(row.id)+'/review'
  body={decision}
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
   (row.kind==='approval'?!result.request||result.request.request_id!==row.id:
    row.kind==='recurring'?result.ok!==true||result.policy?.policy_id!==row.id||
     result.policy?.ledger_applied!==false:
     result.ok!==true||result.consent?.consent_id!==row.id||
     result.consent?.ledger_applied!==false||result.consent?.execution_permitted!==false))
   throw Error(String(result.error||result.code||'操作结果未确认，请核对原申请'))
  message.value=phrase+'已登记'+(decision==='approve'?'，未自动入账':'')
 }catch(e){if(actor===props.userId)error.value=(e as Error).message}
 finally{if(actor===props.userId){busy.value='';await load(page.value,true)}}
}
function foreground(){
 if(document.visibilityState==='visible'&&props.active&&props.isOwner&&!loading.value&&!busy.value)
  void load(page.value,true)
}
watch(()=>[props.active,props.isOwner,props.userId],()=>{
 reset()
 if(props.active&&props.isOwner)void load(0)
},{immediate:true})
onMounted(()=>{document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{reset();document.removeEventListener('visibilitychange',foreground)})
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
    <div class="feed-top">
     <b>{{title(row)}}</b>
     <span class="feed-state">{{row.expires_at<=Date.now()&&
      ['pending','pending_owner','awaiting_recipient','recipient_accepted'].includes(row.status)
      ?'已过期':states[row.status]||row.status}}</span>
    </div>
    <p>{{description(row)}}</p>
    <div v-if="actions(row).length" class="feed-actions">
     <button v-for="decision in actions(row)" :key="decision" type="button"
      :disabled="!!busy||loading" :class="{primary:decision==='approve'||decision==='accept'||decision==='authorize'}"
      @click="act(row,decision)">{{actionLabels[decision]}}</button>
    </div>
   </li>
  </ul>
  <nav v-if="rows.length&&(page>0||hasMore)" class="feed-pages" aria-label="家庭审批分页">
   <button type="button" :disabled="page===0||loading||!!busy" @click="changePage(-1)">上一页</button>
   <span>第 {{page+1}} 页 · 每页 5 条</span>
   <button type="button" :disabled="!hasMore||loading||!!busy" @click="changePage(1)">下一页</button>
  </nav>
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
.feed-success{color:#317855}
.feed-pages{padding-top:10px;border-top:1px solid #edf1ed}
.feed-pages span{font-size:12px;color:#7a8f80;white-space:nowrap}
@media(max-width:360px){.feed-pages{gap:5px}.feed-pages button{padding:8px}.feed-header-actions{gap:0}}
</style>
