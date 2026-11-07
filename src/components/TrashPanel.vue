<script setup lang="ts">
import {ref} from 'vue'
import PageToast from './PageToast.vue'
import StatusBadge from './StatusBadge.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import {usePageToast} from '../page-toast'

type DeletedTask={id:string;title:string;deletedAt:string;kind:string}
const kinds:Record<string,string>={task:'待办',routine:'定期',anniversary:'纪念日',shopping:'购物',
  wish:'心愿',goal:'储值',trip:'旅行',memory:'回忆'}
const expanded=ref(false),rows=ref<DeletedTask[]>([]),cursor=ref<string|null>(null)
const busy=ref(false),loaded=ref(false),error=ref(''),confirmEmpty=ref(false)
const {toast,notify}=usePageToast()

async function fetchTrash(more=false){
 if(busy.value)return
 busy.value=true
 error.value=''
 if(!more)loaded.value=false
 try{
  // Keep the request URL explicit and encoded for iOS Safari / standalone PWA.
  const url='/api/recycle?limit=5'+(more&&cursor.value?'&cursor='+encodeURIComponent(cursor.value):'')
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'})
  if(!response.ok)throw Error('recycle_api_unavailable')
  const data=await response.json()
  if(!Array.isArray(data.items))throw Error('invalid_recycle_response')
  rows.value=more?[...rows.value,...data.items]:data.items
  cursor.value=typeof data.nextCursor==='string'?data.nextCursor:null
  loaded.value=true
 }catch{
  error.value='回收箱读取失败，请重试'
 }finally{busy.value=false}
}
function toggle(){
 expanded.value=!expanded.value
 confirmEmpty.value=false
 if(expanded.value)void fetchTrash()
 else{rows.value=[];cursor.value=null;loaded.value=false;error.value=''}
}
async function restore(item:DeletedTask){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  const response=await fetch('/api/recycle/restore',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify({kind:item.kind,id:item.id})})
  if(!response.ok)throw Error('restore_failed')
  rows.value=rows.value.filter(x=>x.kind!==item.kind||x.id!==item.id)
  notify('已恢复原记录及关联数据')
 }catch{error.value='恢复失败，请重试'}finally{busy.value=false}
}
async function emptyTrash(){
 if(!confirmEmpty.value||busy.value)return
 busy.value=true;error.value=''
 let deleted=0
 try{
  const response=await fetch('/api/recycle/empty',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({confirm:'PERMANENTLY_EMPTY_RECYCLE_BIN'})})
  if(!response.ok)throw Error('empty_failed')
  const data=await response.json()
  if(!data.ok||!Number.isInteger(data.deleted))throw Error('invalid_empty_response')
  deleted=data.deleted
  confirmEmpty.value=false
 }catch{
  error.value='清空失败，数据未被清理，请重试'
  return
 }finally{busy.value=false}
 await fetchTrash()
 if(!error.value){
  notify(rows.value.length||cursor.value
    ?'永久删除 '+deleted+' 条，仍有含照片或关联的事项受到保护'
    :'已永久清空 '+deleted+' 条已删除事项')
 }
}
</script>

<template>
 <section class="task-trash">
  <button type="button" class="trash-toggle" :aria-expanded="expanded" @click="toggle">
    <span>回收箱 · 已删除事项</span><span>{{ expanded?'收起':'展开' }}</span>
  </button>
  <div v-if="expanded" class="trash-body">
   <small>默认永久保留，仅手动清空。</small>
   <p v-if="error" class="trash-error" role="alert">{{ error }}</p>
   <button v-if="error&&!busy" type="button" class="trash-more" @click="fetchTrash()">重试</button>
   <p v-if="busy&&!loaded">正在读取…</p>
   <p v-if="loaded&&!busy&&!error&&!rows.length">暂无已删除事项。</p>
   <div v-for="item in rows" :key="item.kind+':'+item.id" class="trash-item">
    <div><strong>{{ item.title }}</strong>
      <small>{{ kinds[item.kind]||item.kind }} · <StatusBadge code="deleted" /> · 删除：{{ item.deletedAt.slice(0,10) }}</small></div>
    <button type="button" :disabled="busy" @click="restore(item)">恢复</button>
   </div>
   <button v-if="cursor&&!confirmEmpty" type="button" class="trash-more" :disabled="busy"
     @click="fetchTrash(true)">加载更多（5条）</button>
   <template v-if="loaded&&!error&&rows.length">
    <EditBottomSheet v-if="confirmEmpty" title="确认永久清空" :close-disabled="busy" @close="confirmEmpty=false">
    <div class="trash-confirm" role="group" aria-label="确认永久清空">
      <p>清空后无法恢复，部分历史也可能删除。含照片或关联的记录会保留。</p>
      <div class="trash-actions">
       <button type="button" class="trash-cancel" :disabled="busy" @click="confirmEmpty=false">取消</button>
       <button type="button" class="trash-danger" :disabled="busy" @click="emptyTrash">确认永久清空</button>
      </div>
    </div>
    </EditBottomSheet>
    <button v-else type="button" class="trash-clear" :disabled="busy" @click="confirmEmpty=true">
      清空回收箱
    </button>
   </template>
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
.trash-clear{border:0;background:transparent;color:#a04e3d;font-size:12px;font-weight:700;text-align:left;padding:8px 0}
.trash-confirm{border:1px solid #f1d8d2;border-radius:10px;padding:10px;display:grid;gap:8px}
.trash-confirm p{font-size:11px;line-height:1.6;color:#9d5549;margin:0}
.trash-actions{display:flex;gap:8px;justify-content:flex-end}
.trash-actions button{border:0;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700}
.trash-cancel{background:#edf0eb;color:#456653}
.trash-danger{background:#a44e44;color:white}
</style>