<script setup lang="ts">
import {onMounted,ref} from 'vue'
const props=defineProps<{petId:string;name:string}>()
type Health={id:string;recordType:string;eventOn:string;weightGrams:number|null;note:string;nextDueOn:string|null;createdBy:string}
const items=ref<Health[]>([]),kind=ref('deworm'),eventDate=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,10))
const nextDate=ref(''),weight=ref<number|null>(null),note=ref(''),busy=ref(false),error=ref(''),message=ref('')
const names:Record<string,string>={weight:'体重',deworm:'驱虫',vaccination:'疫苗',vet:'看医生',medication:'用药',grooming:'梳毛/洗澡',other:'其他'}
async function read(){
 try{
  const r=await fetch('/api/pets/'+props.petId+'/health',{credentials:'same-origin',cache:'no-store'})
  if(!r.ok)throw Error('读取护理记录失败')
  const data=await r.json();items.value=data.records||[]
 }catch(e){error.value=(e as Error).message}
}
async function create(){
 busy.value=true;error.value='';message.value=''
 try{
  const r=await fetch('/api/pets/'+props.petId+'/health',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify({
      recordType:kind.value,eventOn:eventDate.value,weightGrams:kind.value==='weight'?Number(weight.value):null,
      nextDueOn:nextDate.value||null,note:note.value,visibility:'household'
    })})
  const data=await r.json()
  if(!r.ok)throw Error(data.error||'保存失败')
  await read()
  note.value='';nextDate.value='';weight.value=null
  message.value=data.createdReminder?'保存成功，已经在待办中创建下次提醒':'护理记录已保存'
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
onMounted(read)
</script>
<template>
  <section class="pet-card">
    <h2>🐾 {{ name }}的健康与护理记录</h2>
    <p class="sub">驱虫、疫苗、体重、就诊和日常护理都记录在这里；需要下次提醒时可设置日期。</p>
    <form class="pet-form" @submit.prevent="create">
      <label>记录类型<select v-model="kind"><option v-for="(label,value) in names" :key="value" :value="value">{{ label }}</option></select></label>
      <label>完成日期<input v-model="eventDate" required type="date"/></label>
      <label v-if="kind==='weight'">体重（克）<input v-model.number="weight" required type="number" min="1" max="99999" placeholder="例如 5500"/></label>
      <label v-if="kind!=='weight'">下次提醒（可选）<input v-model="nextDate" type="date" :min="eventDate"/></label>
      <label class="full">备注<input v-model="note" maxlength="1000" placeholder="使用药品、医院、身体情况等"/></label>
      <button class="full" :disabled="busy">{{ busy?'保存中…':'＋ 保存健康记录' }}</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <div v-if="!items.length" class="empty">还没有护理记录，可以先记录一次体重或驱虫。</div>
    <div v-for="r in items" :key="r.id" class="record">
      <div><strong>{{ names[r.recordType]||'护理' }}</strong><span>{{ r.eventOn }}</span></div>
      <p v-if="r.weightGrams">{{ (r.weightGrams/1000).toFixed(2) }} kg</p>
      <p v-if="r.note">{{ r.note }}</p>
      <small v-if="r.nextDueOn">下次计划：{{ r.nextDueOn }}</small>
    </div>
  </section>
</template>
<style scoped>
.pet-card{background:#fff;border:1px solid #eeeae4;border-radius:18px;padding:20px;margin:15px 0}
.pet-card h2{font-size:17px;margin:0}.sub{color:#819187;font-size:12px;line-height:1.7}
.pet-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin:14px 0}
.pet-form label{display:grid;gap:5px;font-size:12px;color:#64796b}
.pet-form input,.pet-form select{width:100%;min-width:0;min-height:42px;border:1px solid #dce6dc;border-radius:10px;padding:9px;font-size:13px;background:white}
.pet-form .full{grid-column:1/-1}
.pet-form button{background:#43866a;color:white;border:0;padding:11px;border-radius:11px;font-weight:700}
.record{padding:12px 0;border-top:1px solid #f1eee8;font-size:13px}
.record div{display:flex;justify-content:space-between;gap:12px}
.record div span,.record small{color:#85958b;font-size:11px}
.record p{line-height:1.6;white-space:pre-wrap;margin:5px 0}
.error{color:#a24e38;background:#fff0e8;padding:10px;border-radius:10px}
.ok{color:#3d8562;background:#e9f5e9;padding:10px;border-radius:10px}
.empty{text-align:center;padding:24px;color:#85958b;font-size:12px}
</style>
