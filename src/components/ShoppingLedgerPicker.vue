<script setup lang="ts">
import DateField from './DateField.vue'
import StatusBadge from './StatusBadge.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import ConfirmActionSheet from './ConfirmActionSheet.vue'
import {useConfirmAction} from '../use-confirm-action'
import {computed,onMounted,ref} from 'vue'
type Entry={id:number|string;date:string;amount:number;merchant?:string;category?:string;type:string}
type Linked={entryId:string|number;entry:Entry|null;needsReview:boolean}
const props=defineProps<{shoppingId:string;linkedId?:string|null}>()
const emit=defineEmits<{saved:[];close:[]}>()
const {request:confirmRequest,confirmAction,accept:acceptConfirm,cancel:cancelConfirm}=useConfirmAction()
const connected=ref(false),loaded=ref(false),busy=ref(false),error=ref('')
const entries=ref<Entry[]>([]),cursor=ref<string|null>(null)
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const month=()=>new Date(Date.now()-30*86400000+9*3600000).toISOString().slice(0,10)
const start=ref(month()),end=ref(today())
const links=ref<Linked[]>([]),linksNeedReview=ref(false)
const linkedEntryIds=computed(()=>new Set(links.value.map(x=>String(x.entryId))))
async function call(path:string,method='GET',body?:any){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
 const result=await response.json().catch(()=>({error:'服务暂时不可用'}))
 if(!response.ok)throw Error(result.error||'服务暂时不可用')
 return result
}
async function check(){
 try{
  const status=await call('/finance/status')
  connected.value=!!status.connected
  if(connected.value)await loadLinks()
 }
 catch(e){error.value=(e as Error).message}
 finally{loaded.value=true}
}
async function search(more=false){
 if(busy.value)return
 error.value='';busy.value=true
 try{
  const q=new URLSearchParams({start:start.value,end:end.value})
  if(more&&cursor.value)q.set('cursor',cursor.value)
  const data=await call('/finance/candidates?'+q)
  entries.value=more?[...entries.value,...(data.entries||[])]:data.entries||[]
  cursor.value=data.nextCursor||null
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function loadLinks(){
 const data=await call('/finance/shopping/'+encodeURIComponent(props.shoppingId)+'/links')
 links.value=data.items||[]
 linksNeedReview.value=!!data.needsReview
}
async function attach(entry:Entry){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  await call('/finance/shopping/'+encodeURIComponent(props.shoppingId)+'/link','POST',{entryId:entry.id})
  await loadLinks()
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function unlink(entryId?:string|number){
 if(busy.value)return
 if(!await confirmAction({title:entryId===undefined?'解除全部账单关联':'解除消费关联',
   confirmLabel:'确认解除',danger:true,
   message:entryId===undefined
     ?'解除全部关联？购物项将恢复为未完成，家計簿交易不会删除。'
     :'解除这笔消费关联吗？如果还有其他关联，购物项会保持完成。'}))return
 busy.value=true;error.value=''
 try{
  await call('/finance/shopping/'+encodeURIComponent(props.shoppingId)+'/link','DELETE',
    entryId===undefined?undefined:{entryId})
  await loadLinks()
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
onMounted(()=>{void check()})
</script>
<template>
 <EditBottomSheet title="查看关联账单" :close-disabled="busy" @close="emit('close')">
 <section class="shopping-ledger">
  <p class="hint">关联一笔真实账单后，这件物品即完成。同一账单可以关联多个物品。</p>
  <p v-if="!loaded" class="hint">正在检查联动…</p>
  <p v-else-if="!connected" class="hint">
    家計簿联动暂不可用，请稍后重试。购物计划仍保持未完成。
  </p>
  <template v-else>
   <div class="ledger-dates">
    <label>开始日期<DateField v-model="start" /></label>
    <label>结束日期<DateField v-model="end" /></label>
   </div>
   <button class="ledger-search" type="button" :disabled="busy" @click="search(false)">查询家計簿支出</button>
   <div v-for="entry in entries" :key="entry.id" class="ledger-entry">
    <span>{{ entry.date }} · {{ entry.merchant||entry.category||'支出' }}
     <small>¥{{ Number(entry.amount||0).toLocaleString('ja-JP') }}</small></span>
    <StatusBadge v-if="linkedEntryIds.has(String(entry.id))" code="linked" />
    <button v-else type="button" :disabled="busy||entry.type!=='expense'"
      @click="attach(entry)">关联并完成</button>
   </div>
   <button v-if="cursor" type="button" :disabled="busy" class="ledger-search" @click="search(true)">加载更多</button>
   <div v-if="links.length" class="shopping-linked">
     <b><StatusBadge code="linked" /> {{ links.length }} 笔消费</b>
     <div v-for="link in links" :key="link.entryId" class="ledger-entry">
       <span><template v-if="link.entry">{{ link.entry.date }}</template><StatusBadge v-else code="verification_pending" label="原始明细不可用" /> · {{ link.entry?.merchant||('账目 #'+link.entryId) }}
         <small v-if="link.entry">¥{{ Number(link.entry.amount).toLocaleString('ja-JP') }}</small>
         <small v-else><StatusBadge code="verification_pending" label="需要重新核对" /></small></span>
       <button type="button" class="ledger-unlink" :disabled="busy" @click="unlink(link.entryId)">解除这一笔</button>
     </div>
     <small v-if="linksNeedReview" class="ledger-error"><StatusBadge code="verification_pending" label="待核对" /> 关联消费已变更，请核对。</small>
     <button type="button" class="ledger-unlink" :disabled="busy" @click="unlink()">解除全部关联</button>
   </div>
  </template>
  <p v-if="error" role="alert" class="ledger-error">{{ error }}</p>
  <button type="button" class="ledger-close" @click="emit('close')">关闭</button>
 </section>
 </EditBottomSheet>
 <ConfirmActionSheet v-if="confirmRequest" :request="confirmRequest"
   @confirm="acceptConfirm" @cancel="cancelConfirm"/>
</template>
<style scoped>
.shopping-ledger{margin:0;padding:0;background:transparent;border:0;border-radius:0;display:grid;gap:12px}
.shopping-ledger>b{font-size:14px}.hint{font-size:12px;line-height:1.7;color:#688574;margin:0}
.ledger-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.ledger-dates label{display:grid;gap:5px;min-width:0;font-size:12px;color:#607c6d}
.ledger-dates input{width:100%;min-width:0;max-width:100%;box-sizing:border-box;border:1px solid #cadbd1;border-radius:9px;padding:9px;font-size:12px;background:#fff}
.ledger-entry{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;padding:10px 0;border-bottom:1px solid #e1ebe4;min-width:0}
.ledger-entry span{flex:1;min-width:0;overflow-wrap:anywhere}.ledger-entry button{flex:0 1 auto;max-width:55%}
.shopping-ledger button{min-height:44px;touch-action:manipulation;border:0;border-radius:9px;padding:9px;font-size:12px;background:#478869;color:#fff}
.shopping-ledger button:disabled{opacity:.5}.shopping-ledger .ledger-close{background:#e4eee7;color:#3e775a}
.shopping-ledger .ledger-unlink{background:#fff;color:#ac5e4c;border:1px solid #edc8bf}
.shopping-linked{display:grid;gap:8px;padding:9px 0;border-top:1px solid #d9eadf}
.shopping-linked>b{font-size:12px;color:#496c59}
.ledger-error{color:#a14d37;font-size:12px}
@media(max-width:600px){.ledger-dates{grid-template-columns:minmax(0,1fr)}.shopping-ledger>.ledger-search{width:100%}.ledger-entry button{max-width:48%;font-size:12px}.ledger-entry{align-items:center}}
</style>
