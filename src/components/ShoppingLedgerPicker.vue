<script setup lang="ts">
import DateField from './DateField.vue'
import {onMounted,ref} from 'vue'
type Entry={id:number|string;date:string;amount:number;merchant?:string;category?:string;type:string}
const props=defineProps<{shoppingId:string;linkedId?:string|null}>()
const emit=defineEmits<{saved:[];close:[]}>()
const connected=ref(false),loaded=ref(false),busy=ref(false),error=ref('')
const entries=ref<Entry[]>([]),cursor=ref<string|null>(null)
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const month=()=>new Date(Date.now()-30*86400000+9*3600000).toISOString().slice(0,10)
const start=ref(month()),end=ref(today())
const adjustment=ref('0'),linkedAmount=ref<number|null>(null),savedMessage=ref('')
const adjustedTotal=()=>Number(linkedAmount.value||0)+Number(adjustment.value||0)
const signed=(n:number)=>(n<0?'−':n>0?'+':'')+'¥'+Math.abs(n).toLocaleString('ja-JP')
async function call(path:string,method='GET',body?:any){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
 const result=await response.json().catch(()=>({error:'服务暂时不可用'}))
 if(!response.ok)throw Error(result.error||'服务暂时不可用')
 return result
}
async function check(){
 try{const status=await call('/finance/status');connected.value=!!status.connected}
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
async function attach(entry:Entry){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  await call('/finance/shopping/'+encodeURIComponent(props.shoppingId)+'/link','POST',{entryId:entry.id})
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function unlink(){
 if(busy.value||!confirm('取消这笔消费关联并将购物项恢复为未完成吗？家計簿明细不会被删除。'))return
 busy.value=true;error.value=''
 try{
  await call('/finance/shopping/'+encodeURIComponent(props.shoppingId)+'/link','DELETE')
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function loadSettings(){
 try{
  const q=new URLSearchParams({type:'shopping',targetId:props.shoppingId})
  const data=await call('/finance/settings?'+q)
  adjustment.value=String(data.adjustmentAmount||0)
  linkedAmount.value=Number.isSafeInteger(data.linkedAmount)?data.linkedAmount:null
 }catch(e){error.value=(e as Error).message}
}
async function saveAdjustment(){
 if(busy.value)return
 const value=Number(adjustment.value)
 if(!/^-?\d+$/.test(adjustment.value.trim())||!Number.isSafeInteger(value)||Math.abs(value)>100000000000){
  error.value='调整额请输入整数日元';return
 }
 busy.value=true;error.value='';savedMessage.value=''
 try{
  await call('/finance/settings','PUT',{type:'shopping',targetId:props.shoppingId,adjustmentAmount:value})
  savedMessage.value='调整额已保存，原始账目未改变'
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
onMounted(()=>{void check();void loadSettings()})
</script>
<template>
 <section class="shopping-ledger">
  <b>关联家計簿真实支出</b>
  <p class="hint">请从交易记录中选择，不自动猜测购物内容；选中后自动完成，不会再次记账。</p>
  <p v-if="!loaded" class="hint">正在检查联动…</p>
  <p v-else-if="!connected" class="hint">
    家計簿只读联动尚未启用，请在 HomeFlow 和家計簿的 Cloudflare 加密 Secrets 中配置相同的专用只读密钥。
    暂时仍可手动勾选完成购物。
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
    <button type="button" :disabled="busy||entry.type!=='expense'" @click="attach(entry)">关联并完成</button>
   </div>
   <button v-if="cursor" type="button" :disabled="busy" class="ledger-search" @click="search(true)">加载更多</button>
   <button v-if="linkedId" type="button" class="ledger-unlink" :disabled="busy" @click="unlink">取消已有关联</button>
  </template>
  <div class="shopping-adjustment">
   <b>购物金额调整</b>
   <div class="adjustment-breakdown">
    <span>关联消费 {{ linkedAmount===null?'尚未关联':signed(linkedAmount) }}</span>
    <span>手动调整 {{ signed(Number(adjustment)||0) }}</span>
    <strong>调整后金额 {{ signed(adjustedTotal()) }}</strong>
   </div>
   <label>手动调整额（円，可输入正负数）
    <input v-model="adjustment" type="number" step="1" inputmode="numeric"/>
   </label>
   <button type="button" :disabled="busy" @click="saveAdjustment">保存调整额</button>
   <small>调整额只保存在 HomeFlow，不会修改家計簿。未关联时显示调整额本身。</small>
   <small v-if="savedMessage" role="status">{{ savedMessage }}</small>
  </div>
  <p v-if="error" role="alert" class="ledger-error">{{ error }}</p>
  <button type="button" class="ledger-close" @click="emit('close')">关闭</button>
 </section>
</template>
<style scoped>
.shopping-ledger{margin:11px 0 15px;padding:14px;background:#f5faf6;border:1px solid #d9eadf;border-radius:12px;display:grid;gap:10px}
.shopping-ledger>b{font-size:14px}.hint{font-size:12px;line-height:1.7;color:#688574;margin:0}
.ledger-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.ledger-dates label{display:grid;gap:5px;min-width:0;font-size:12px;color:#607c6d}
.ledger-dates input{width:100%;min-width:0;max-width:100%;box-sizing:border-box;border:1px solid #cadbd1;border-radius:9px;padding:9px;font-size:12px;background:#fff}
.ledger-entry{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;padding:8px 0;border-bottom:1px solid #e1ebe4}
.ledger-entry span{min-width:0;overflow-wrap:anywhere}.ledger-entry small{display:block;color:#789284;margin-top:3px}
.shopping-ledger button{border:0;border-radius:9px;padding:9px;font-size:12px;background:#478869;color:#fff}
.shopping-ledger button:disabled{opacity:.5}.shopping-ledger .ledger-close{background:#e4eee7;color:#3e775a}
.shopping-ledger .ledger-unlink{background:#fff;color:#ac5e4c;border:1px solid #edc8bf}
.shopping-adjustment{border-top:1px solid #d9eadf;padding-top:12px;display:grid;gap:9px}
.shopping-adjustment>b{font-size:13px}.shopping-adjustment label{display:grid;gap:5px;font-size:12px;color:#607c6d}
.shopping-adjustment input{width:100%;max-width:100%;box-sizing:border-box;min-height:41px;border:1px solid #cadbd1;border-radius:9px;background:#fff;padding:9px}
.adjustment-breakdown{display:grid;gap:5px;font-size:12px;color:#607c6d}.adjustment-breakdown strong{font-size:15px;color:#264b3b}
.shopping-adjustment small{font-size:11px;color:#718e7c}
.ledger-error{color:#a14d37;font-size:12px}
@media(max-width:600px){.ledger-dates{grid-template-columns:minmax(0,1fr)}}
</style>
