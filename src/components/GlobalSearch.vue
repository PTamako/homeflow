<script setup lang="ts">
import {ref} from 'vue'
import EditBottomSheet from './EditBottomSheet.vue'
type Result={id:string;kind:string;title:string;event_date:string}
const emit=defineEmits<{select:[result:Result]}>()
const open=ref(false),keyword=ref(''),kind=ref('all'),year=ref(''),month=ref('')
const rows=ref<Result[]>([]),cursor=ref<string|null>(null),busy=ref(false),error=ref('')
const labels:Record<string,string>={task:'任务',routine:'定期',anniversary:'纪念日',
 shopping:'购物',wish:'心愿',goal:'储值',trip:'旅行',memory:'时光轴'}
let revision=0
let activeRequest:AbortController|null=null
function cancelPending(){
 revision++
 activeRequest?.abort()
 activeRequest=null
 busy.value=false
 error.value=''
}
function resetFilters(){cancelPending();rows.value=[];cursor.value=null}
async function load(more=false){
 if(busy.value||!keyword.value.trim())return
 const token=++revision
 const controller=new AbortController()
 activeRequest=controller
 busy.value=true;error.value=''
 try{
  const query=new URLSearchParams({q:keyword.value.trim(),kind:kind.value})
  if(year.value){query.set('year',year.value);if(month.value)query.set('month',month.value)}
  if(more&&cursor.value)query.set('cursor',cursor.value)
  const response=await fetch('/api/search?'+query,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
  const data=await response.json()
  if(!response.ok)throw Error(data.error||'搜索失败')
  if(token!==revision)return
  rows.value=more?[...rows.value,...data.items]:data.items
  cursor.value=data.nextCursor||null
 }catch(e){if(token===revision&&!controller.signal.aborted)error.value=(e as Error).message}
 finally{if(activeRequest===controller)activeRequest=null;if(token===revision)busy.value=false}
}
function yearChanged(){if(!year.value)month.value='';resetFilters()}
function closeSearch(){
 open.value=false
 cancelPending()
 keyword.value='';kind.value='all';year.value='';month.value=''
 rows.value=[];cursor.value=null
}
function toggle(){if(open.value)closeSearch();else open.value=true}
function selected(row:Result){emit('select',row);closeSearch()}
const years=Array.from({length:16},(_,i)=>String(new Date().getFullYear()-i))
</script>
<template>
<div class="global-search">
 <button type="button" class="search-trigger" :aria-expanded="open" aria-label="全站搜索"
   @click="toggle">搜索</button>
 <EditBottomSheet v-if="open" title="全站搜索" @close="toggle">
 <section class="search-panel">
  <form @submit.prevent="load(false)">
   <label>查找计划、任务、纪念日与回忆
    <input v-model="keyword" @input="resetFilters" maxlength="60" placeholder="输入关键词" required autocomplete="off" enterkeyhint="search" inputmode="search"/>
   </label>
   <div class="search-filters">
    <select v-model="kind" @change="resetFilters" aria-label="搜索类型">
     <option value="all">全部类型</option>
     <option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</option>
    </select>
    <select v-model="year" aria-label="搜索年份" @change="yearChanged">
     <option value="">全部年份</option>
     <option v-for="y in years" :key="y" :value="y">{{ y }}年</option>
    </select>
    <select v-model="month" @change="resetFilters" aria-label="搜索月份" :disabled="!year">
     <option value="">全年</option>
     <option v-for="m in 12" :key="m" :value="String(m).padStart(2,'0')">{{ m }}月</option>
    </select>
   </div>
   <button type="submit" class="search-submit" :disabled="busy">{{ busy?'搜索中…':'查找' }}</button>
  </form>
  <p v-if="error" role="alert" class="search-error">{{ error }}</p>
  <div class="search-results">
   <button v-for="r in rows" :key="r.kind+':'+r.id" type="button" @click="selected(r)">
    <strong>{{ r.title }}</strong><small>{{ labels[r.kind]||r.kind }} · {{ r.event_date }}</small>
   </button>
  </div>
  <button v-if="cursor" type="button" class="search-more" :disabled="busy" @click="load(true)">加载更多（5条）</button>
  <button type="button" class="search-close" @click="toggle">关闭</button>
 </section>
 </EditBottomSheet>
</div>
</template>
<style scoped>
.global-search{position:relative}
.search-trigger{min-height:40px;padding:7px 10px;border:1px solid #d8e6db;background:#fff;border-radius:11px;color:#43866a;font-size:13px;font-weight:700}
.search-panel{position:static;width:100%;max-height:none;overflow:visible;background:transparent;border:0;border-radius:0;box-shadow:none;padding:0;display:grid;gap:12px}
.search-panel form{display:grid;gap:8px}
.search-panel label{display:grid;gap:5px;font-size:12px}
.search-panel input,.search-panel select{width:100%;min-width:0;min-height:44px;border:1px solid #dce5de;border-radius:9px;padding:7px;background:white;color:#24382d}
.search-filters{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,.75fr);gap:5px}
.search-filters select{font-size:12px;padding:5px}
.search-submit,.search-more{min-height:44px;background:#43866a;color:white;border:0;border-radius:10px;padding:8px 12px;font-size:12px}
.search-results{display:grid;gap:2px}
.search-results button{min-height:52px;min-width:0;overflow-wrap:anywhere;border:0;border-bottom:1px solid #edf0eb;padding:8px 2px;text-align:left;background:white;display:grid;gap:3px}
.search-results small{color:#839287;font-size:11px}
.search-error{color:#a04f3b;font-size:12px}
.search-close{border:0;background:transparent;font-size:12px;color:#739481}
@media(max-width:520px){.search-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.search-filters select:first-child{grid-column:1/-1}.search-panel input,.search-panel select{font-size:16px}.search-results{overscroll-behavior:contain}}
</style>
