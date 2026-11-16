<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'

type ConsentState='awaiting_recipient'|'recipient_accepted'|'owner_authorized'|
 'recipient_rejected'|'cancelled'|'revoked'
type Consent={
 consent_id:string;resource_id:string;source_user_id:string;recipient_user_id:string
 status:ConsentState;version:number;expires_at:number;ledger_applied:false
 execution_permitted:false
}
const props=defineProps<{
 active:boolean;userId:string;isOwner:boolean
 members?:Array<{id:string;loginName:string}>
 profiles?:Array<{memberUserId:string|null;displayName:string}>
}>()
const items=ref<Consent[]>([])
const available=ref(false),expanded=ref(false),loading=ref(false)
const error=ref(''),message=ref(''),busy=ref('')
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
let epoch=0
function person(id:string){
 return props.profiles?.find(x=>x.memberUserId===id)?.displayName||
 props.members?.find(x=>x.id===id)?.loginName||
 (id===props.userId?'我':'另一位家庭成员')
}
function label(state:ConsentState){
 return {
  awaiting_recipient:'待收款人独立确认',
  recipient_accepted:'双方已确认 · 待管理员另行授权',
  owner_authorized:'已完成三方授权 · 尚未记账',
  recipient_rejected:'收款人拒绝',
  cancelled:'已撤回',
  revoked:'已撤销授权'
 }[state]||'待确认'
}
function cleanup(){
 epoch++;items.value=[];available.value=false;expanded.value=false
 loading.value=false;error.value='';message.value='';busy.value=''
 cancelConfirm()
}
async function load(preserveFeedback=false){
 if(!props.active||!props.userId)return
 const n=++epoch,account=props.userId
 loading.value=true
 if(!preserveFeedback){error.value='';message.value=''}
 try{
  const r=await fetch('/api/finance-cross-member/consents',{
   credentials:'same-origin',cache:'no-store'})
  if(!props.active||n!==epoch||account!==props.userId)return
  if(r.status===503||r.status===404){available.value=false;items.value=[];return}
  const data=await r.json()
  if(!r.ok||data.ok!==true||data.ledger_applied!==false||!Array.isArray(data.items))
   throw new Error(data.code||'双人确认列表暂不可读取')
  available.value=true
  items.value=data.items.filter((x:Consent)=>x&&typeof x.consent_id==='string'&&
   x.ledger_applied===false&&x.execution_permitted===false)
 }catch(e){
  if(n===epoch&&account===props.userId){
   items.value=[];error.value=(e as Error).message
  }
 }finally{if(n===epoch&&account===props.userId)loading.value=false}
}
function actions(x:Consent){
 if(x.status==='awaiting_recipient'&&x.recipient_user_id===props.userId)
  return ['accept','reject'] as const
 if(x.status==='recipient_accepted'&&props.isOwner)return ['authorize'] as const
 if(x.status==='owner_authorized'&&
  (x.source_user_id===props.userId||x.recipient_user_id===props.userId))return ['revoke'] as const
 if(['awaiting_recipient','recipient_accepted'].includes(x.status)&&
  x.source_user_id===props.userId)return ['cancel'] as const
 return [] as const
}
const names:Record<string,string>={
 accept:'确认接收',reject:'拒绝',authorize:'管理员单独授权',revoke:'撤销授权',cancel:'撤回申请'
}
async function act(x:Consent,kind:string){
 if(!props.active||busy.value||loading.value||!actions(x).includes(kind as never))return
 const account=props.userId,now=epoch,version=x.version
 if(!await confirmAction({
  title:names[kind],confirmLabel:'确认'+names[kind],
  message:kind==='authorize'?
   '双方已经各自确认，但管理员授权仍不会自动汇款或记账；后续需单独核对真实转账证据。':
   kind==='accept'?
   '这是你本人同意接收该笔申请，尚不表示银行实际到账，也不授权自动入账。':
   '此决定会记录不可变审计，且不能通过重复提交同一申请改变结果。',
  ...(kind==='reject'||kind==='revoke'?{danger:true}:{})
 }))return
 if(!props.active||account!==props.userId||now!==epoch||
  !items.value.some(c=>c.consent_id===x.consent_id&&c.version===version))return
 busy.value=x.consent_id;error.value='';message.value=''
 const route=kind==='accept'||kind==='reject'?'recipient':kind
 const body={expected_user_id:account,expected_version:version,
  ...(route==='recipient'?{decision:kind}:{} )}
 try{
  const response=await fetch('/api/finance-cross-member/consents/'+x.consent_id+'/'+route,{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const result=await response.json().catch(()=>({}))
  if(!props.active||account!==props.userId||now!==epoch)return
  if(!response.ok||result.ok!==true||result.consent?.ledger_applied!==false||
   result.consent?.execution_permitted!==false)
   throw new Error(result.code||'状态未确认，请按原申请核对')
  message.value=names[kind]+'已登记，未发生任何账务转移。'
 }catch(e){if(props.active&&account===props.userId&&now===epoch)
  error.value=(e as Error).message
 }finally{
  if(props.active&&account===props.userId&&now===epoch){
   busy.value='';await load(true)
  }
 }
}
function foreground(){
 if(document.visibilityState==='visible'&&props.active)void load(true)
}
watch(()=>[props.userId,props.active],()=>{cleanup();if(props.active)void load()})
onMounted(()=>{void load();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{cleanup();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <section v-if="available" class="panel cross-consent" aria-label="跨成员资产转移双人确认">
  <header class="cross-head">
   <div class="management-section-heading">
    <AppIcon name="handshake" :size="20"/>
    <h2>跨成员转账 · 双人确认</h2>
   </div>
   <button type="button" class="outline" :aria-expanded="expanded"
    @click="expanded=!expanded">{{expanded?'收起':'查看'}}</button>
  </header>
  <div v-if="expanded" class="cross-content">
   <p class="hint">这是转出人、收款人与家庭管理员的独立同意记录。即使三项完成，也不会自动转账或计入家計簿。</p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <p v-if="message" class="hint" role="status">{{message}}</p>
   <div class="cross-actions">
    <button type="button" class="outline" :disabled="loading||!!busy" @click="load(true)">核对最新状态</button>
   </div>
   <p v-if="loading" class="hint">读取中…</p>
   <p v-else-if="!items.length" class="hint">目前没有需要双人确认的转账申请。</p>
   <ul v-else class="cross-list">
    <li v-for="c in items" :key="c.consent_id">
     <b>{{person(c.source_user_id)}} → {{person(c.recipient_user_id)}}</b>
     <span>{{label(c.status)}}</span>
     <small>申请 {{c.resource_id.slice(0,8)}} · 版本 {{c.version}}</small>
     <div class="cross-actions">
      <button v-for="kind in actions(c)" :key="kind" type="button"
       class="outline" :disabled="!!busy||loading" @click="act(c,kind)">
       {{names[kind]}}
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
.cross-consent{min-width:0}
.cross-head{display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap}
.cross-head h2{font-size:14px}
.cross-head button,.cross-actions button{min-height:44px}
.cross-content{display:grid;gap:10px;margin-top:10px}
.cross-list{list-style:none;display:grid;gap:9px;padding:0;margin:0}
.cross-list li{min-width:0;display:grid;gap:6px;border:1px solid var(--line,#e0e9e4);
 border-radius:12px;padding:11px;background:var(--card,#fff)}
.cross-list b{font-size:13px}
.cross-list span,.cross-list small,.hint{font-size:12px;color:var(--muted,#6b7772)}
.cross-actions{display:flex;flex-wrap:wrap;gap:7px}
.cross-actions button{border-radius:10px;padding:7px 12px}
.error{color:#b44646;font-size:12px}
</style>
