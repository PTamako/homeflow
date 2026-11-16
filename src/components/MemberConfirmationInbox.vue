<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'

type Item={
 kind:'approval'|'recurring'|'consent';id:string;actor_user_id:string
 recipient_user_id:string|null;status:string;created_at:number;expires_at:number
 version:number;operation:string|null;plan_type:string|null;amount_jpy:number|null
 due_day:number|null;start_month:string|null;end_month:string|null
}
const props=defineProps<{active:boolean;userId:string;isOwner:boolean;
 members?:Array<{id:string;loginName:string}>;
 profiles?:Array<{memberUserId:string|null;displayName:string}>}>()
const rows=ref<Item[]>([]),page=ref(0),hasMore=ref(false)
const loading=ref(false),busy=ref(''),error=ref(''),message=ref('')
let epoch=0
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
const visible=computed(()=>loading.value||!!error.value||!!message.value||rows.value.length>0)
const states:Record<string,string>={
 pending:'待管理员审批',pending_owner:'等待管理员首次批准',
 awaiting_recipient:'等待收款人确认',recipient_accepted:'等待管理员授权',
 owner_authorized:'已授权，尚未入账'
}
const operations:Record<string,string>={
 'finance.entry.create':'新增家庭账目',
 'finance.entry.update':'修改家庭账目',
 'finance.entry.delete':'删除家庭账目',
 'finance.entry.restore':'恢复家庭账目',
 'finance.asset_transfer.bank_to_bank':'银行资产转移',
 'finance.credit_card.purchase':'信用卡消费',
 'finance.credit_card.settlement':'信用卡还款',
 'document.sync.finance':'文书同步账目',
 'document.sync.homeflow':'文书同步待办',
 'finance.sbi_cash.tsumitate':'SBI 定投',
 'finance.sbi_cash.additional':'SBI 追加买付'
}
function person(id:string|null){
 if(!id)return '家庭成员'
 return props.profiles?.find(p=>p.memberUserId===id)?.displayName||
  props.members?.find(m=>m.id===id)?.loginName||
  (id===props.userId?'我':'家庭成员')
}
function title(item:Item){
 if(item.kind==='approval')return operations[item.operation||'']||'家庭账务申请'
 if(item.kind==='recurring')return item.plan_type==='sbi_tsumitate'?'SBI 定投计划':'固定费用计划'
 return '跨成员转账'
}
function desc(item:Item){
 if(item.kind==='consent')
  return person(item.actor_user_id)+' → '+person(item.recipient_user_id)
 if(item.kind==='recurring'){
  const value=new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',
   maximumFractionDigits:0}).format(item.amount_jpy||0)
  return value+' / 月 · 每月 '+item.due_day+' 日 · '+item.start_month+'～'+item.end_month
 }
 return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Tokyo',
  month:'2-digit',day:'2-digit'}).format(new Date(item.created_at))
}
function actions(item:Item):Array<'cancel'|'accept'|'reject'>{
 if(item.expires_at<=Date.now())return []
 if(item.kind==='approval')return item.status==='pending'&&
  item.actor_user_id===props.userId?['cancel']:[]
 if(item.kind==='recurring')return item.status==='pending_owner'&&
  item.actor_user_id===props.userId?['cancel']:[]
 if(item.status==='awaiting_recipient'&&item.recipient_user_id===props.userId)
  return ['reject','accept']
 if(['awaiting_recipient','recipient_accepted'].includes(item.status)&&
  item.actor_user_id===props.userId)return ['cancel']
 return []
}
const actionLabel:Record<string,string>={
 cancel:'撤回申请',accept:'确认接收',reject:'拒绝接收'
}
async function load(n=page.value,keepMessage=false){
 if(!props.active||props.isOwner||!props.userId||busy.value)return
 const token=++epoch,actor=props.userId
 loading.value=true
 if(!keepMessage){error.value='';message.value=''}
 try{
  const res=await fetch('/api/my-confirmations?page='+n,{
   credentials:'same-origin',cache:'no-store'})
  const data=await res.json().catch(()=>({}))
  if(token!==epoch||actor!==props.userId||!props.active||props.isOwner)return
  if(!res.ok||data.ok!==true||data.page_size!==5||!Array.isArray(data.items)||
    data.items.length>5)throw Error(String(data.code||'我的申请暂时读取失败'))
  rows.value=data.items
  page.value=n;hasMore.value=data.has_more===true
 }catch(e){
  if(token===epoch&&actor===props.userId){
   rows.value=[];hasMore.value=false;error.value=(e as Error).message
  }
 }finally{if(token===epoch)loading.value=false}
}
function move(delta:number){
 if(loading.value||busy.value||delta>0&&!hasMore.value||delta<0&&page.value===0)return
 void load(page.value+delta)
}
async function act(item:Item,action:'cancel'|'accept'|'reject'){
 if(!props.active||props.isOwner||!!busy.value||loading.value||!actions(item).includes(action))return
 const actor=props.userId,token=epoch
 const label=actionLabel[action]
 if(!await confirmAction({
  title:label+' · '+title(item),confirmLabel:'确认'+label,
  message:action==='accept'
   ?'仅确认本人接收，不自动银行转账，也不代表家計簿已入账。'
   :'只会更新原申请的状态，不会改变已经发生的真实银行流水。',
  ...(action==='reject'?{danger:true}:{})
 }))return
 if(token!==epoch||actor!==props.userId||!props.active||props.isOwner||
  !rows.value.some(x=>x.kind===item.kind&&x.id===item.id&&
    x.status===item.status&&x.version===item.version))return
 let path:string
 let body:Record<string,string|number>
 if(item.kind==='approval'){
  path='/api/approvals/'+item.id+'/cancel';body={}
 }else if(item.kind==='recurring'){
  path='/api/recurring-finance/policies/'+item.id+'/cancel'
  body={expected_user_id:actor,expected_version:item.version}
 }else{
  path='/api/finance-cross-member/consents/'+item.id+
   (action==='cancel'?'/cancel':'/recipient')
  body={expected_user_id:actor,expected_version:item.version,
   ...(action==='cancel'?{}:{decision:action})}
 }
 busy.value=item.kind+':'+item.id;error.value='';message.value=''
 try{
  const response=await fetch(path,{method:'POST',credentials:'same-origin',
   cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const result=await response.json().catch(()=>({}))
  if(actor!==props.userId||!props.active||props.isOwner)return
  const accepted=item.kind==='approval'?
   result.request?.request_id===item.id&&result.request.status==='cancelled':
   item.kind==='recurring'?
    result.ok===true&&result.policy?.policy_id===item.id&&result.policy.status==='cancelled':
    result.ok===true&&result.consent?.consent_id===item.id&&
    result.consent?.ledger_applied===false&&
    result.consent?.status===(action==='accept'?'recipient_accepted':
      action==='reject'?'recipient_rejected':'cancelled')
  if(!response.ok||!accepted)throw Error(String(result.code||result.error||'申请处理结果未确认'))
  message.value=label+'成功'
 }catch(e){if(actor===props.userId)error.value=(e as Error).message}
 finally{if(actor===props.userId){busy.value='';await load(page.value,true)}}
}
function reset(){
 epoch++;rows.value=[];page.value=0;hasMore.value=false;loading.value=false
 busy.value='';error.value='';message.value='';cancelConfirm()
}
function foreground(){
 if(document.visibilityState==='visible'&&props.active&&!props.isOwner&&
  !busy.value&&!loading.value)void load(page.value,true)
}
watch(()=>[props.active,props.isOwner,props.userId],()=>{
 reset()
 if(props.active&&!props.isOwner&&props.userId)void load(0)
},{immediate:true})
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <section v-if="active&&!isOwner&&visible" class="panel member-confirmations" aria-label="我的待确认">
  <div class="member-confirmations-head">
   <div class="management-section-heading">
    <AppIcon name="handshake" :size="20"/><h2>我的待确认</h2>
   </div>
   <button type="button" class="member-refresh" :disabled="loading||!!busy" @click="load(page)">刷新</button>
  </div>
  <p v-if="error" class="member-error" role="alert">{{error}}</p>
  <p v-if="message" class="member-success" role="status">{{message}}</p>
  <p v-if="loading" class="member-empty" role="status">正在读取…</p>
  <ul v-else class="member-list">
   <li v-for="item in rows" :key="item.kind+':'+item.id" class="member-item">
    <div class="member-title">
     <b>{{title(item)}}</b><span>{{item.expires_at<=Date.now()?'已过期':states[item.status]||item.status}}</span>
    </div>
    <p>{{desc(item)}}</p>
    <div v-if="actions(item).length" class="member-actions">
     <button v-for="action in actions(item)" :key="action" type="button"
      :disabled="!!busy||loading" :class="{primary:action==='accept'}"
      @click="act(item,action)">{{actionLabel[action]}}</button>
    </div>
   </li>
  </ul>
  <nav v-if="rows.length&&(page>0||hasMore)" class="member-pages" aria-label="我的待确认分页">
   <button type="button" :disabled="page===0||loading||!!busy" @click="move(-1)">上一页</button>
   <span>第 {{page+1}} 页 · 每页 5 条</span>
   <button type="button" :disabled="!hasMore||loading||!!busy" @click="move(1)">下一页</button>
  </nav>
  <ConfirmActionSheet v-if="confirmRequest" :request="confirmRequest"
   @confirm="acceptConfirm" @cancel="cancelConfirm"/>
 </section>
</template>
<style scoped>
.member-confirmations{min-width:0}
.member-confirmations-head,.member-title,.member-pages{
 display:flex;align-items:center;justify-content:space-between;gap:8px
}
.member-confirmations-head{margin-bottom:8px}
.member-confirmations-head h2{margin:0}
.member-refresh{min-height:44px;border:0;background:transparent;color:#3b7859;font-weight:700;font-size:13px}
.member-list{padding:0;margin:0;list-style:none;display:grid}
.member-item{border-top:1px solid #e7eee8;padding:13px 0}
.member-title{align-items:flex-start}
.member-title b{font-size:14px}
.member-title span{font-size:11px;color:#698575;text-align:right}
.member-item p{margin:7px 0 0;color:#70877b;font-size:12px;overflow-wrap:anywhere}
.member-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.member-actions button,.member-pages button{
 min-height:44px;border:1px solid #c6d8c9;border-radius:10px;
 background:#fff;color:#3b7859;padding:8px 12px;font-size:13px;font-weight:700
}
.member-actions .primary{background:#3b7859;color:#fff}
.member-pages{padding-top:10px;border-top:1px solid #e7eee8}
.member-pages span{font-size:12px;color:#748678;white-space:nowrap}
.member-empty,.member-error,.member-success{font-size:13px;margin:8px 0;overflow-wrap:anywhere}
.member-error{color:#aa4545}
.member-success{color:#357854}
.member-empty{color:#71867b}
</style>
