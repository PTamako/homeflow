<script setup lang="ts">
import DateField from './DateField.vue'
import {computed,onMounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import SwipeActions from './SwipeActions.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
const props=defineProps<{petId:string;name:string;userId:string}>()
type Health={id:string;recordType:string;eventOn:string;weightGrams:number|null;note:string;nextDueOn:string|null;createdBy:string;sourceRoutineId?:string|null;sourceTaskId?:string|null}
const items=ref<Health[]>([]),kind=ref('deworm'),eventDate=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,10))
const nextDate=ref(''),weight=ref<number|null>(null),note=ref(''),busy=ref(false),error=ref('')
const editingId=ref<string|null>(null)
const showHealthForm=ref(false)
const {toast,notify}=usePageToast()
const year=ref(''),month=ref(''),nextCursor=ref<string|null>(null)
const reading=ref(false)
type WeightPoint={eventOn:string;weightGrams:number}
const weightPoints=ref<WeightPoint[]>([])
const latestWeight=computed(()=>weightPoints.value.at(-1))
const previousWeight=computed(()=>weightPoints.value.length>1?weightPoints.value.at(-2):null)
const weightDifference=computed(()=>latestWeight.value&&previousWeight.value?
  latestWeight.value.weightGrams-previousWeight.value.weightGrams:null)
const weightPolyline=computed(()=>{
 const points=weightPoints.value
 if(points.length<2)return ''
 const values=points.map(p=>p.weightGrams)
 const min=Math.min(...values),span=Math.max(1,Math.max(...values)-min)
 return points.map((p,i)=>[12+276*i/(points.length-1),
   68-48*(p.weightGrams-min)/span].map(n=>n.toFixed(1)).join(',')).join(' ')
})
async function loadWeightTrend(){
 try{
  const response=await fetch('/api/pets/'+props.petId+'/health/trend',{credentials:'same-origin',cache:'no-store'})
  if(!response.ok)return
  const data=await response.json()
  weightPoints.value=Array.isArray(data.points)?data.points:[]
 }catch{/* Keep health entry usable when optional trend is unavailable. */}
}
let readRevision=0
const yearOptions=Array.from({length:16},(_,i)=>String(new Date().getFullYear()-i))
const monthOptions=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))
function pageUrl(more=false){
  const query=new URLSearchParams({limit:'5'})
  if(year.value){query.set('year',year.value);if(month.value)query.set('month',month.value)}
  if(more&&nextCursor.value)query.set('cursor',nextCursor.value)
  return '/api/pets/'+props.petId+'/health?'+query
}
const names:Record<string,string>={weight:'体重',deworm:'驱虫',vaccination:'疫苗',vet:'看医生',medication:'用药',grooming:'梳毛/洗澡',other:'日常护理'}
async function read(more=false){
 if(more&&reading.value)return
 const revision=++readRevision
 reading.value=true;error.value=''
 const requestUrl=pageUrl(more)
 try{
  const r=await fetch(requestUrl,{credentials:'same-origin',cache:'no-store'})
  if(!r.ok)throw Error('读取护理记录失败')
  const data=await r.json()
  if(revision!==readRevision||requestUrl!==pageUrl(more))return
  items.value=more?[...items.value,...(data.records||[])]:data.records||[]
  nextCursor.value=data.nextCursor||null
 }catch(e){error.value=(e as Error).message}
 finally{if(revision===readRevision)reading.value=false}
}
function editRecord(r:Health){
  editingId.value=r.id;kind.value=r.recordType;eventDate.value=r.eventOn
  nextDate.value=r.nextDueOn||'';weight.value=r.weightGrams;note.value=r.note||''
  error.value='';showHealthForm.value=true
}
function cancelEditing(){
  editingId.value=null;kind.value='deworm';eventDate.value=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  note.value='';nextDate.value='';weight.value=null;showHealthForm.value=false;error.value=''
}
function toggleHealthForm(){
  if(showHealthForm.value)cancelEditing()
  else {editingId.value=null;showHealthForm.value=true}
}
async function removeRecord(r:Health){
  if(r.createdBy!==props.userId||!confirm('删除这条护理记录吗？已单独建立的提醒任务不会被自动删除。'))return
  busy.value=true;error.value=''
  try{
    const res=await fetch('/api/pets/'+props.petId+'/health/'+r.id,{method:'DELETE',credentials:'same-origin'})
    if(!res.ok)throw Error('删除护理记录失败')
    await read();void loadWeightTrend();if(editingId.value===r.id)cancelEditing()
    notify('护理记录已删除')
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function create(){
 busy.value=true;error.value=''
 try{
  const r=await fetch('/api/pets/'+props.petId+'/health'+(editingId.value?'/'+editingId.value:''),{
    method:editingId.value?'PATCH':'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify({
      recordType:kind.value,eventOn:eventDate.value,weightGrams:kind.value==='weight'?Number(weight.value):null,
      nextDueOn:nextDate.value||null,note:note.value,visibility:'household'
    })})
  const data=await r.json()
  if(!r.ok)throw Error(data.error||'保存失败')
  await read()
  void loadWeightTrend()
  const edited=!!editingId.value
  cancelEditing()
  notify(edited?'护理记录已更新':data.createdReminder?'已保存，并创建下次提醒':'护理记录已保存')
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
onMounted(()=>{void read();void loadWeightTrend()})
watch(()=>props.petId,()=>{cancelEditing();weightPoints.value=[];void read();void loadWeightTrend()})
watch([year,month],()=>void read())
watch(year,value=>{if(!value)month.value=''})
</script>
<template>
  <section class="pet-card">
    <h2 class="pet-title"><AppIcon name="paw" :size="20" /> {{ name }}的健康与护理记录</h2>
    <div v-if="latestWeight" class="weight-trend">
      <b>最近体重 {{ (latestWeight.weightGrams/1000).toFixed(2) }} kg</b>
      <small>{{ latestWeight.eventOn }}
        <template v-if="weightDifference!==null"> · 较上次 {{ weightDifference>0?'+':'' }}{{ (weightDifference/1000).toFixed(2) }} kg</template>
      </small>
      <svg v-if="weightPoints.length>1" viewBox="0 0 300 88" role="img"
        aria-label="最近24次体重变化趋势" preserveAspectRatio="none">
        <polyline :points="weightPolyline" fill="none" stroke="#43866a"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <button type="button" class="pet-more" :aria-expanded="showHealthForm"
      :aria-controls="'pet-health-form-'+petId" :disabled="busy" @click="toggleHealthForm">
      {{ showHealthForm?'收起表单':'＋ 添加护理记录' }}
    </button>
    <EditBottomSheet v-if="showHealthForm" :title="editingId?'编辑护理记录':'添加护理记录'" :close-disabled="busy" @close="cancelEditing">
    <form :id="'pet-health-form-'+petId" class="pet-form" @submit.prevent="create">
      <label>记录类型<select v-model="kind"><option v-for="(label,value) in names" :key="value" :value="value">{{ label }}</option></select></label>
      <label>完成日期<DateField v-model="eventDate" required /></label>
      <label v-if="kind==='weight'">体重（克）<input v-model.number="weight" required type="number" min="1" max="99999" placeholder="例如 5500"/></label>
      <label v-if="kind!=='weight'">下次提醒（可选）<DateField v-model="nextDate" :min="eventDate" /></label>
      <label class="full">备注<input v-model="note" maxlength="1000" placeholder="使用药品、医院、身体情况等"/></label>
      <div class="full pet-form-actions">
        <button type="button" class="pet-cancel" :disabled="busy" @click="cancelEditing">取消</button>
        <button :disabled="busy">{{ busy?'保存中…':editingId?'保存修改':'＋ 保存健康记录' }}</button>
      </div>
    </form>
    </EditBottomSheet>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <PageToast :toast="toast" />
    <div class="pet-history-filter">
      <label>年份<select v-model="year" aria-label="宠物护理记录年份">
        <option value="">全部年份</option><option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
      </select></label>
      <label>月份<select v-model="month" :disabled="!year" aria-label="宠物护理记录月份">
        <option value="">全年</option><option v-for="m in monthOptions" :key="m" :value="m">{{ Number(m) }} 月</option>
      </select></label>
    </div>

    <div v-if="!items.length" class="empty">暂无护理记录</div>
    <div v-for="r in items" :key="r.id" class="record">
      <SwipeActions :id="r.id" scope="pet-health"
        :allow-edit="r.createdBy===props.userId" :allow-delete="r.createdBy===props.userId"
        @edit="editRecord(r)" @delete="removeRecord(r)">
        <div class="record-heading">
          <strong>{{ names[r.recordType]||'护理' }}<template v-if="r.sourceRoutineId"> · 定期任务</template><template v-else-if="r.sourceTaskId"> · 今日任务</template></strong><span>{{ r.eventOn }}</span>
        </div>
      </SwipeActions>
      <p v-if="r.weightGrams">{{ (r.weightGrams/1000).toFixed(2) }} kg</p>
      <p v-if="r.note">{{ r.note }}</p>
      <small v-if="r.nextDueOn">下次计划：{{ r.nextDueOn }}</small>
    </div>
    <button v-if="nextCursor" type="button" class="pet-more" :disabled="reading" @click="read(true)">加载更多护理记录</button>
  </section>
</template>
<style scoped>
.pet-card{background:#fff;border:1px solid #eeeae4;border-radius:18px;padding:20px;margin:15px 0}
.pet-card h2{font-size:17px;margin:0}
.weight-trend{display:grid;gap:5px;padding:12px;background:#f3f8f3;border-radius:12px;margin:12px 0}
.weight-trend b{font-size:13px;color:#3b7655}
.weight-trend small{color:#819187;font-size:11px}
.weight-trend svg{display:block;width:100%;height:86px}.pet-title{display:flex;align-items:center;gap:9px}.sub{color:#819187;font-size:12px;line-height:1.7}
.pet-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin:0;min-width:0}
.pet-form label{display:grid;gap:5px;font-size:12px;color:#64796b;min-width:0;max-width:100%}
.pet-form input,.pet-form select{width:100%;max-width:100%;min-width:0;box-sizing:border-box;min-height:42px;border:1px solid #dce6dc;border-radius:10px;padding:9px;font-size:13px;background:white}
.pet-form .full{grid-column:1/-1}
.pet-form button{background:#43866a;color:white;border:0;padding:11px;border-radius:11px;font-weight:700}
.pet-form-actions{display:flex;justify-content:flex-end;gap:10px}
.pet-form-actions button{flex:1}
.pet-form-actions .pet-cancel{color:#478467;background:#e7f1e9}
.record{padding:12px 0;border-top:1px solid #f1eee8;font-size:13px}
.record-heading{display:flex;justify-content:space-between;gap:12px;padding:6px 0}
.record div span,.record small{color:#85958b;font-size:11px}
.record p{line-height:1.6;white-space:pre-wrap;margin:5px 0}
.error{color:#a24e38;background:#fff0e8;padding:10px;border-radius:10px}
.ok{color:#3d8562;background:#e9f5e9;padding:10px;border-radius:10px}
.empty{text-align:center;padding:24px;color:#85958b;font-size:12px}
@media(max-width:720px){
  .pet-form{grid-template-columns:minmax(0,1fr)}
  .pet-form .full{grid-column:1}
  .pet-card{padding:16px}
  .pet-form input[type="date"]{min-inline-size:0}
}

.pet-history-filter{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:17px}
.pet-history-filter label{display:grid;gap:5px;font-size:12px;color:#698172;min-width:0}
.pet-history-filter select{width:100%;max-width:100%;min-width:0;min-height:40px;padding:8px;border:1px solid #d4e2d7;border-radius:9px;background:white;color:#304938}
.pet-history-filter select:disabled{opacity:.5}
.pet-more{display:block;margin:12px auto;border:1px solid #b6d4c0;background:#f5faf6;color:#397959;padding:9px 15px;border-radius:10px;font-size:12px}
@media(max-width:420px){.pet-history-filter{gap:7px}}
</style>
