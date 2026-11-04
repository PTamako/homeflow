<script setup lang="ts">
import {computed,onMounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
type Item=Record<string,any>
const props=defineProps<{trips:Item[];goals:Item[];owner:boolean}>()
const available=ref(false),checked=ref(false),kind=ref<'trip'|'goal'>('trip'),target=ref('')
const start=ref(''),end=ref(''),entries=ref<Item[]>([]),links=ref<Item[]>([])
const nextCursor=ref<string|null>(null),busy=ref(false),error=ref(''),message=ref('')
const options=computed(()=>kind.value==='trip'?props.trips:props.goals)
const selected=computed(()=>options.value.find(x=>x.id===target.value))
const total=computed(()=>links.value.reduce((n,item)=>n+Number(item.entry?.amount||0),0))
const fmt=(amount:number)=>'¥'+Number(amount||0).toLocaleString('ja-JP')
const dateYmd=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
function defaultDates(){
  const date=new Date(Date.now()-29*86400000+9*3600000)
  start.value=date.toISOString().slice(0,10)
  end.value=dateYmd()
}
async function api(path:string,method='GET',payload?:unknown):Promise<any>{
  const r=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
    ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})})
  const data=await r.json()
  if(!r.ok)throw Error(data.error||'操作失败')
  return data
}
async function detect(){
  if(!props.owner)return
  try{
    const status=await api('/finance/status')
    available.value=!!status.connected;checked.value=true
  }catch(e){error.value=(e as Error).message;checked.value=true}
}
async function refreshLinks(){
  links.value=[]
  if(!available.value||!target.value)return
  try{
    const data=await api('/finance/links?type='+encodeURIComponent(kind.value)+'&targetId='+encodeURIComponent(target.value))
    links.value=data.items||[]
  }catch(e){error.value=(e as Error).message}
}
async function loadCandidates(more=false){
  if(!available.value||!start.value||!end.value||!target.value)return
  busy.value=true;error.value='';message.value=''
  try{
    const params=new URLSearchParams({start:start.value,end:end.value})
    if(more&&nextCursor.value)params.set('cursor',nextCursor.value)
    const data=await api('/finance/candidates?'+params.toString())
    entries.value=more?[...entries.value,...(data.entries||[])]:data.entries||[]
    nextCursor.value=data.nextCursor||null
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function linkEntry(entry:Item){
  if(!target.value)return
  busy.value=true;error.value=''
  try{
    await api('/finance/links','POST',{type:kind.value,targetId:target.value,entryId:entry.id})
    await refreshLinks();message.value='已关联家計簿真实支出，不会再次记账'
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function unlink(item:Item){
  busy.value=true;error.value=''
  try{
    await api('/finance/links/'+encodeURIComponent(item.linkId),'DELETE')
    await refreshLinks();message.value='已取消关联；原记账明细不受影响'
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
watch([kind,target],()=>{entries.value=[];nextCursor.value=null;refreshLinks()})
watch(kind,()=>{target.value=''})
watch(selected,value=>{
  if(!value)return
  const s=value.startOn||value.start_on
  const e=value.endOn||value.end_on
  if(s&&e){
    const days=Math.round((Date.parse(e+'T00:00:00Z')-Date.parse(s+'T00:00:00Z'))/86400000)
    if(days<=90&&days>=0){start.value=s;end.value=e}
  }
})
onMounted(()=>{defaultDates();detect()})
</script>
<template>
  <section v-if="owner" class="finance-card">
    <h2 class="finance-title"><AppIcon name="wallet" :size="20" /> 家計簿 · 实际旅行开销</h2>
    <p class="hint">财务数据只从家計簿安全读取。HomeFlow 仅保存你确认关联的明细 ID，不创建新支出。</p>
    <div v-if="!checked" class="hint">正在检查连接状态…</div>
    <p v-else-if="!available" class="hint">
      家計簿联动目前未启用。需要两边分别设置专用只读密钥后才能查看真实交易；储蓄目标不受影响。
    </p>
    <template v-else>
      <div class="fields">
        <label>关联对象
          <select v-model="kind"><option value="trip">旅行计划</option><option value="goal">储蓄目标</option></select>
        </label>
        <label>选择项目
          <select v-model="target"><option value="">请选择</option>
            <option v-for="item in options" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
        </label>
      </div>
      <template v-if="target">
        <div class="summary"><span>已关联实际支出</span><strong>{{ fmt(total) }}</strong><small>{{ links.filter(x=>x.entry).length }} 笔已核对的真实支出</small></div>
        <div v-for="row in links" :key="row.linkId" class="line">
          <span>{{ row.entry?.date||'原账目已删除' }} · {{ row.entry?.merchant||('明细 #'+row.entryId) }}<small>{{ row.entry?fmt(row.entry.amount):'未找到明细' }}</small></span>
          <button type="button" class="unlink" @click="unlink(row)" :disabled="busy">移除关联</button>
        </div>
        <div class="fields">
          <label>起始日期<input v-model="start" type="date"/></label>
          <label>结束日期<input v-model="end" type="date"/></label>
        </div>
        <button type="button" :disabled="busy" @click="loadCandidates(false)">查找家計簿支出</button>
        <div v-for="row in entries" :key="row.id" class="line">
          <span>{{ row.date }} · {{ row.merchant||row.category }}<small>{{ fmt(row.amount) }}</small></span>
          <button type="button" :disabled="busy || links.some(x=>String(x.entryId)===String(row.id))" @click="linkEntry(row)">
            {{ links.some(x=>String(x.entryId)===String(row.id))?'已关联':'关联' }}</button>
        </div>
        <button v-if="nextCursor" type="button" class="more" :disabled="busy" @click="loadCandidates(true)">加载更多支出</button>
      </template>
    </template>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="success">{{ message }}</p>
  </section>
</template>
<style scoped>
.finance-card{background:#fff;border:1px solid #eceae4;border-radius:18px;padding:18px;margin-top:16px}
.finance-card h2{font-size:17px;margin:0 0 10px}.hint{font-size:12px;line-height:1.7;color:#839087}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0;min-width:0}
.fields label{font-size:12px;color:#607469;display:grid;gap:5px;min-width:0;max-width:100%}
.fields select,.fields input{border:1px solid #dce6dc;border-radius:10px;min-width:0;max-width:100%;box-sizing:border-box;width:100%;min-height:41px;padding:8px;background:#fff}
button{background:#488d6c;color:#fff;border:0;border-radius:9px;padding:9px 12px;font-size:12px}
button:disabled{opacity:.55}.summary{background:#eaf4ec;border-radius:12px;padding:14px;display:grid;gap:3px;margin:14px 0}
.summary strong{font-size:22px}.summary span,.summary small{font-size:12px;color:#587564}
.line{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #f0eee9;padding:10px 0;font-size:12px}
.line span{min-width:0;overflow-wrap:anywhere}.line small{display:block;color:#7a9083;margin-top:3px}
.line .unlink{background:#f3f5ee;color:#758978}.more{margin-top:8px;background:#eef5ed;color:#488d6c}
.error{font-size:12px;color:#a94d37}.success{font-size:12px;color:#3f876a}
@media(max-width:720px){.fields{grid-template-columns:minmax(0,1fr)}}
</style>
