<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'

type Policy={
 policy_id:string;member_user_id:string;owner_user_id:string|null
 plan_resource_id:string;plan_type:'fixed_cost'|'sbi_tsumitate'
 source_account_version:number;due_day:number;max_amount_jpy:number
 start_month:string;end_month:string
 status:'pending_owner'|'approved'|'rejected'|'cancelled'|'revoked'
 version:number;ledger_applied:false;cron_enabled:false
 occurrence_execution_permitted:false
}
const props=defineProps<{
 active:boolean;userId:string;isOwner:boolean
 members?:Array<{id:string;loginName:string}>
 profiles?:Array<{memberUserId:string|null;displayName:string}>
}>()
const policies=ref<Policy[]>([])
const enabled=ref(false),expanded=ref(false),loading=ref(false),busy=ref('')
const message=ref(''),error=ref('')
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
let epoch=0,alive=true
function name(id:string){
 return props.profiles?.find(p=>p.memberUserId===id)?.displayName||
  props.members?.find(m=>m.id===id)?.loginName||'家庭成员'
}
const currency=(n:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',
 currency:'JPY',maximumFractionDigits:0}).format(n)
const status=(s:Policy['status'])=>({
 pending_owner:'等待管理员批准额度',approved:'已批准 · 每月凭实际到账证据记账',
 rejected:'审批拒绝',cancelled:'成员撤回',revoked:'授权已撤销'
}[s]||'尚未确认')
function reset(){
 epoch++;policies.value=[];enabled.value=false;expanded.value=false
 loading.value=false;busy.value='';error.value='';message.value=''
 cancelConfirm()
}
async function load(preserve=false){
 if(!props.active||!props.userId||!alive)return
 const now=++epoch,account=props.userId
 loading.value=true
 if(!preserve){message.value='';error.value=''}
 try{
  const res=await fetch('/api/recurring-finance/policies',{
   credentials:'same-origin',cache:'no-store'})
  if(now!==epoch||!props.active||!alive||account!==props.userId)return
  if([404,503].includes(res.status)){
   enabled.value=false;policies.value=[];return
  }
  const data=await res.json()
  if(!res.ok||data.ok!==true||data.ledger_applied!==false||!Array.isArray(data.items))
   throw new Error(data.code||'定期金融授权读取失败')
  enabled.value=true
  policies.value=data.items.filter((p:Policy)=>p?.ledger_applied===false&&
   p.cron_enabled===false&&p.occurrence_execution_permitted===false)
 }catch(e){
  if(now===epoch&&account===props.userId){
   error.value=(e as Error).message
   policies.value=[]
  }
 }finally{if(now===epoch&&account===props.userId)loading.value=false}
}
function actions(p:Policy){
 if(p.status==='pending_owner'&&props.isOwner)return ['approve','reject']
 if(p.status==='pending_owner'&&p.member_user_id===props.userId)return ['cancel']
 if(p.status==='approved'&&(props.isOwner||p.member_user_id===props.userId))
  return ['revoke']
 return []
}
const labels:Record<string,string>={
 approve:'批准月度额度',reject:'拒绝计划',cancel:'撤回计划',revoke:'撤销周期授权'
}
async function act(p:Policy,kind:string){
 if(!props.active||!alive||busy.value||loading.value||!actions(p).includes(kind))return
 const n=epoch,account=props.userId,version=p.version
 if(!await confirmAction({
  title:labels[kind],confirmLabel:'确认'+labels[kind],
  message:kind==='approve'
   ?'仅批准该计划每月额度、日期、账户版本和起止月。不会自动扣款或发起 SBI 买单；实际已发生的银行／证券凭证仍需在家計簿逐月执行并核对回执。'
   :'此决定会记录不可变审计。已经实际入账的旧账不受撤权影响。',
  ...(kind==='reject'||kind==='revoke'?{danger:true}:{})
 }))return
 if(!props.active||!alive||n!==epoch||account!==props.userId||
  !policies.value.some(x=>x.policy_id===p.policy_id&&x.version===version))return
 busy.value=p.policy_id;message.value='';error.value=''
 const action=kind==='approve'||kind==='reject'?'review':kind
 const data={expected_user_id:account,expected_version:version,
  ...(action==='review'?{decision:kind}:{})}
 try{
  const res=await fetch('/api/recurring-finance/policies/'+p.policy_id+'/'+action,{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json'},body:JSON.stringify(data)})
  const result=await res.json().catch(()=>({}))
  if(!props.active||!alive||n!==epoch||account!==props.userId)return
  if(!res.ok||result.ok!==true||result.policy?.ledger_applied!==false||
   result.policy?.cron_enabled!==false||result.policy?.occurrence_execution_permitted!==false)
   throw new Error(result.code||'授权状态不确定，请核对原授权 ID')
  message.value=labels[kind]+'已记录，但不等于实际入账或外部机构核验。'
 }catch(e){
  if(n===epoch&&account===props.userId)error.value=(e as Error).message
 }finally{
  if(n===epoch&&account===props.userId){busy.value='';await load(true)}
 }
}
function foreground(){if(document.visibilityState==='visible'&&props.active)void load(true)}
watch(()=>[props.userId,props.active],()=>{reset();if(props.active)void load()})
onMounted(()=>{void load();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <section v-if="enabled" class="panel recurring-finance" aria-label="周期金融授权">
  <header class="recurring-head">
   <div class="management-section-heading">
    <AppIcon name="calendar-heart" :size="20"/>
    <h2>周期金融授权</h2>
   </div>
   <button type="button" class="outline" :aria-expanded="expanded"
    @click="expanded=!expanded">{{expanded?'收起':'查看授权'}}</button>
  </header>
  <div v-if="expanded" class="recurring-body">
   <p class="hint">仅查看固定费与 SBI 定投授权。管理员批准不代表扣款或成交；家計簿只可凭每月已发生证据单独记账，银行/SBI 官方核验仍待完成。</p>
   <p v-if="error" role="alert" class="error">{{error}}</p>
   <p v-if="message" role="status" class="hint">{{message}}</p>
   <button type="button" class="outline" :disabled="loading||!!busy"
    @click="load(true)">刷新授权状态</button>
   <p v-if="loading" class="hint">正在读取…</p>
   <p v-else-if="!policies.length" class="hint">暂无周期财务授权申请。</p>
   <ul v-else class="policies">
    <li v-for="p in policies" :key="p.policy_id">
     <strong>{{p.plan_type==='fixed_cost'?'固定费用':'SBI 定投'}} · {{name(p.member_user_id)}}</strong>
     <span>{{status(p.status)}}</span>
     <small>最高 {{currency(p.max_amount_jpy)}}／月 · 每月 {{p.due_day}} 日</small>
     <small>{{p.start_month}}～{{p.end_month}} · 账户版本 {{p.source_account_version}}</small>
     <small>未启用 Cron；每月唯一凭证须单独执行和读取 K 原始账本回执</small>
     <div class="recurring-actions">
      <button v-for="action in actions(p)" :key="action" type="button"
       class="outline" :disabled="loading||!!busy" @click="act(p,action)">
       {{labels[action]}}
      </button>
     </div>
    </li>
   </ul>
  </div>
  <ConfirmActionSheet v-if="confirmRequest" :request="confirmRequest"
   @confirm="acceptConfirm" @cancel="cancelConfirm"/>
 </section>
</template>
<style scoped>
.recurring-finance{min-width:0}
.recurring-head{display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap}
.recurring-head h2{font-size:14px}
.recurring-body{display:grid;gap:10px;margin-top:10px;min-width:0}
.recurring-body button{min-height:44px}
.policies{list-style:none;display:grid;gap:9px;margin:0;padding:0}
.policies li{display:grid;gap:6px;border:1px solid var(--line,#e0e9e4);
 background:var(--card,#fff);padding:11px;border-radius:12px;min-width:0}
.policies strong{font-size:13px}
.policies span,.policies small,.hint{font-size:12px;color:var(--muted,#6b7772)}
.recurring-actions{display:flex;flex-wrap:wrap;gap:8px}
.recurring-actions button{border-radius:10px}
.error{color:#b44646;font-size:12px}
</style>
