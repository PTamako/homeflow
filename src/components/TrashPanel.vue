<script setup lang="ts">
import {ref} from 'vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
type DeletedTask={id:string;title:string;deletedAt:string;dueOn:string|null}
const expanded=ref(false),rows=ref<DeletedTask[]>([]),cursor=ref<string|null>(null)
const busy=ref(false),error=ref('')
const {toast,notify}=usePageToast()
async function fetchTrash(more=false){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  const qs=new URLSearchParams({limit:'5'})
  if(more&&cursor.value)qs.set('cursor',cursor.value)
  const response=await fetch('/api/tasks/trash?'+qs,{credentials:'same-origin',cache:'no-store'})
  const data=await response.json()
  if(!response.ok)throw Error('读取回收箱失败')
  rows.value=more?[...rows.value,...data.items]:data.items
  cursor.value=data.nextCursor||null
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
function toggle(){
 expanded.value=!expanded.value
 if(expanded.value)void fetchTrash()
 else{rows.value=[];cursor.value=null}
}
async function restore(id:string){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  const response=await fetch('/api/tasks/'+id+'/restore',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:'{}'})
  if(!response.ok)throw Error('恢复失败，请重试')
  rows.value=rows.value.filter(x=>x.id!==id)
  notify('待办已恢复，可在计划中查看')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <section class="task-trash">
  <button type="button" class="trash-toggle" :aria-expanded="expanded" @click="toggle">
    <span>回收箱 · 已删除待办</span><span>{{ expanded?'收起':'展开' }}</span>
  </button>
  <div v-if="expanded" class="trash-body">
   <p v-if="error" class="trash-error" role="alert">{{ error }}</p>
   <small>仅显示当前账号创建并删除的待办。</small>
   <p v-if="!rows.length&&!busy">暂无已删除待办。</p>
   <div v-for="item in rows" :key="item.id" class="trash-item">
    <div><strong>{{ item.title }}</strong><small>删除：{{ item.deletedAt.slice(0,10) }}</small></div>
    <button type="button" :disabled="busy" @click="restore(item.id)">恢复</button>
   </div>
   <button v-if="cursor" type="button" class="trash-more" :disabled="busy" @click="fetchTrash(true)">加载更多（5条）</button>
  </div>
  <PageToast :toast="toast"/>
 </section>
</template>
<style scoped>
.task-trash{display:grid;gap:8px}
.trash-toggle{border:0;background:transparent;color:#41795b;padding:7px 0;font-size:12px;font-weight:700;display:flex;justify-content:space-between;gap:8px;text-align:left}
.trash-body{display:grid;gap:8px}
.trash-body>small,.trash-body>p{color:#809086;font-size:11px;margin:0}
.trash-item{display:flex;justify-content:space-between;gap:8px;align-items:center;border-top:1px solid #edf0eb;padding:8px 0}
.trash-item strong{font-size:12px;overflow-wrap:anywhere}
.trash-item small{display:block;color:#849387;font-size:11px;margin-top:4px}
.trash-item button,.trash-more{border:0;background:#e6f2e7;color:#387656;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:700}
.trash-error{color:#a04e3d!important}
</style>
