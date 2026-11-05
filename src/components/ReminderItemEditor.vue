<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'

const props=defineProps<{kind:'task'|'routine'|'trip';itemId:string}>()
const emit=defineEmits<{close:[];saved:[]}>()
const loading=ref(false),busy=ref(false),error=ref('')
const lead=ref(0),defaultDays=ref(0),priority=ref<'normal'|'important'>('normal')
const customized=ref(false)
const {toast,notify}=usePageToast()
let serial=0
const endpoint=()=>'/api/reminders/item?'+new URLSearchParams({kind:props.kind,id:props.itemId})
async function load(){
 const current=++serial
 loading.value=true;error.value=''
 try{
  const response=await fetch(endpoint(),{credentials:'same-origin',cache:'no-store'})
  const data=await response.json()
  if(!response.ok)throw Error(data.error||'提醒设置读取失败')
  if(current!==serial)return
  lead.value=data.advanceDays||0
  defaultDays.value=data.defaultDays||0
  priority.value=data.priority==='important'?'important':'normal'
  customized.value=!!data.customized
 }catch(e){if(current===serial)error.value=(e as Error).message}
 finally{if(current===serial)loading.value=false}
}
async function save(reset=false){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  const response=await fetch('/api/reminders/item',{
   credentials:'same-origin',method:reset?'DELETE':'PUT',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({kind:props.kind,id:props.itemId,
    advanceDays:lead.value,priority:priority.value})
  })
  const data=await response.json()
  if(!response.ok)throw Error(data.error||'提醒设置保存失败')
  await load()
  notify(reset?'已恢复默认提醒':'单项提醒已保存')
  emit('saved')
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
watch(()=>[props.kind,props.itemId],()=>{void load()},{immediate:true})
onBeforeUnmount(()=>{serial++})
</script>
<template>
 <section class="plan-reminder-editor" aria-label="单项提醒设置">
  <b>单项提醒</b>
  <p v-if="loading" class="editor-hint">加载中…</p>
  <template v-else>
   <div class="editor-fields">
    <label>提前天数
     <select v-model.number="lead" :disabled="busy">
      <option :value="0">到期当天</option><option :value="1">提前 1 天</option>
      <option :value="3">提前 3 天</option><option :value="7">提前 7 天</option>
     </select>
    </label>
    <label>提醒级别
     <select v-model="priority" :disabled="busy">
      <option value="normal">普通</option><option value="important">重要</option>
     </select>
    </label>
   </div>
   <small class="editor-hint">{{ customized?'单项提醒':'默认提前 '+defaultDays+' 天' }}</small>
   <div class="editor-actions">
    <button type="button" :disabled="busy" @click="save()">保存</button>
    <button v-if="customized" type="button" :disabled="busy" @click="save(true)">恢复默认</button>
    <button type="button" :disabled="busy" @click="emit('close')">关闭</button>
   </div>
  </template>
  <p v-if="error" role="alert" class="editor-error">{{ error }}</p>
  <PageToast :toast="toast"/>
 </section>
</template>
<style scoped>
.plan-reminder-editor{border:1px solid #d9eadf;background:#f6fbf7;border-radius:10px;
 padding:10px;display:grid;gap:7px;margin:5px 0 9px;min-width:0}
.plan-reminder-editor>b{font-size:12px;color:#406e56}
.editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.editor-fields label{display:grid;gap:4px;font-size:11px;color:#5d7565;min-width:0}
.editor-fields select{min-width:0;width:100%;padding:7px;border:1px solid #c6dccd;
 border-radius:8px;background:white;font-size:12px}
.editor-hint{font-size:11px;color:#718778;margin:0}
.editor-actions{display:flex;gap:7px;flex-wrap:wrap}
.editor-actions button{border:1px solid #d4e5d8;padding:7px 10px;font-size:11px;
 border-radius:8px;background:#e5efe8;color:#427b59}
.editor-actions button:first-child{background:#478869;color:white}
.editor-actions button:disabled{opacity:.5}
.editor-error{font-size:12px;color:#af4f45}
</style>
