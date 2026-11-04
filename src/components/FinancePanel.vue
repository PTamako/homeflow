<script setup lang="ts">
import {onMounted,ref} from 'vue'
const props=defineProps<{tripId:string;tripTitle:string}>()
type Entry={id:number;date:string;amount:number;category:string;merchant:string;linked:boolean}
const configured=ref(false),checking=ref(true),busy=ref(false)
const error=ref(''),notice=ref('')
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const initialFrom=today.slice(0,7)+'-01'
const from=ref(initialFrom),to=ref(today),entries=ref<Entry[]>([]),truncated=ref(false),total=ref(0)
async function api(path:string, method='GET',body?:unknown){
 const res=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
 const value=await res.json()
 if(!res.ok)throw Error(String(value.error||'request_failed'))
 return value
}
function validWindow(){
 const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000
 return Number.isFinite(days)&&days>=0&&days<=31
}
async function check(){
 checking.value=true
 try{configured.value=!!(await api('/finance/status')).configured}
 catch{configured.value=false}
 finally{checking.value=false}
}
async function load(){
 error.value='';notice.value=''
 if(!validWindow()){error.value='请选择最多 31 天的日期范围';return}
 busy.value=true
 try{
  const q=new URLSearchParams({from:from.value,to:to.value})
  const data=await api('/finance/trips/'+props.tripId+'?'+q)
  entries.value=data.items||[];total.value=data.linkedTotal||0;truncated.value=!!data.truncated
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
async function toggle(e:Entry){
 error.value='';notice.value='';busy.value=true
 try{
  await api('/finance/trips/'+props.tripId+'/links','POST',{
    entryId:e.id,linked:!e.linked,from:from.value,to:to.value
  })
  // Always re-read the authoritative ledger; local amounts are never saved as actuals.
  await load()
  notice.value='已更新关联，不会新增家計簿交易'
 }catch(ex){error.value=(ex as Error).message}
 finally{busy.value=false}
}
onMounted(check)
</script>

<template>
 <section class="finance-card" aria-label="旅行实际支出">
  <div class="finance-head"><b>¥ 家計簿 · 旅行实际支出</b><span>仅账本所有者可见</span></div>
  <p class="hint">手动关联家計簿中的真实支出，不重复记账；目标预留金额不是实际消费。</p>
  <p v-if="checking" class="hint">正在检查联动配置…</p>
  <template v-else-if="!configured">
    <p class="hint">家計簿安全只读联动尚未启用。需要先完成双方的专用 API 与 Secret 授权。</p>
  </template>
  <template v-else>
    <form class="range" @submit.prevent="load">
      <label>起始日期<input v-model="from" type="date" required/></label>
      <label>结束日期<input v-model="to" type="date" required/></label>
      <button :disabled="busy">查询明细</button>
    </form>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="good" role="status">{{ notice }}</p>
    <div v-if="entries.length" class="total">
      <span>已关联支出（本次日期范围）</span><strong>¥{{ total.toLocaleString('ja-JP') }}</strong>
    </div>
    <p v-if="truncated" class="alert">超过单次 200 笔上限，请缩小日期范围，以免遗漏明细。</p>
    <div v-for="entry in entries" :key="entry.id" class="entry">
      <label><input type="checkbox" :checked="entry.linked" :disabled="busy" @change="toggle(entry)"/>
      <span><b>{{ entry.merchant||entry.category }}</b>
      <small>{{ entry.date }} · {{ entry.category }}</small></span></label>
      <strong>¥{{ entry.amount.toLocaleString('ja-JP') }}</strong>
    </div>
    <p v-if="!entries.length" class="hint">选择日期范围并点击查询，勾选属于这次旅行的消费。</p>
  </template>
 </section>
</template>

<style scoped>
.finance-card{margin:16px 0;background:#fff;border:1px solid #e1eae0;border-radius:14px;padding:15px}
.finance-head,.total,.entry{display:flex;justify-content:space-between;gap:10px;align-items:center}
.finance-head{flex-wrap:wrap}.finance-head b{font-size:15px}.finance-head span{font-size:11px;color:#7d9081}
.hint{font-size:12px;color:#7d9083;line-height:1.6;margin:10px 0}
.range{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:13px 0}
.range label{font-size:11px;color:#768b7e;display:grid;gap:5px}.range input{min-width:0;width:100%;padding:8px;border:1px solid #dbe4da;border-radius:9px}
.range button{grid-column:1/-1;background:#448666;border:0;border-radius:9px;color:white;padding:10px}
.entry{border-top:1px solid #e8eee8;padding:12px 0;font-size:12px}.entry label{display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}.entry input{accent-color:#478a68}
.entry small{display:block;color:#85998c;margin-top:3px}
.total{padding:12px 0;border-top:1px solid #e9f0e8}.total span{font-size:11px;color:#7d9584}.total strong{font-size:15px}
.alert,.good{font-size:12px;padding:9px;border-radius:8px}.alert{color:#9b5544;background:#fff0e9}.good{color:#347f54;background:#e7f5ed}
</style>
