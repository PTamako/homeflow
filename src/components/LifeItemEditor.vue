<script setup lang="ts">
import {reactive,ref} from 'vue'
type Kind='routines'|'anniversaries'|'wishes'|'goals'|'shopping'|'memories'|'trips'
type Item=Record<string,any>
const props=defineProps<{kind:Kind;item:Item}>()
const emit=defineEmits<{saved:[];cancel:[]}>()
const busy=ref(false),error=ref('')
const data=props.item
const config=(()=>{try{return typeof data.repeat_config==='string'?JSON.parse(data.repeat_config):data.repeat_config||{}}catch{return {}}})()
const mode=data.repeat_type==='weekly'&&config.excludeJapaneseHolidays?'workday':data.repeat_type
const form=reactive({
 title:String(data.title||''),visibility:String(data.visibility||'household'),
 quantity:Number(data.quantity||1),eventDate:String(data.event_date||''),
 repeatMode:String(data.repeat_mode||'yearly'),note:String(data.note||''),
 repeatType:String(mode||'daily'),repeatDays:Number(config.days||7),
 repeatAnchor:String(config.anchor||'fixed'),anchorDate:String(data.anchor_date||''),
 wishType:String(data.wish_type||'other'),status:String(data.status||'wished'),
 estimatedAmount:Number(data.estimated_amount||0),
 targetAmount:Number(data.target_amount||0),reservedAmount:Number(data.reserved_amount||0),
 targetOn:String(data.target_on||''),happenedOn:String(data.happened_on||''),
 story:String(data.story||''),destination:String(data.destination||''),
 startOn:String(data.startOn||data.start_on||''),
 endOn:String(data.endOn||data.end_on||''),budgetAmount:Number(data.budgetAmount||data.budget_amount||0)
})
function values(){
 const common={title:form.title.trim(),visibility:form.visibility}
 if(!common.title||common.title.length>150)throw Error('名称须为 1～150 个字符')
 switch(props.kind){
  case 'shopping':
   return {...common,quantity:form.quantity}
  case 'anniversaries':
   return {...common,eventDate:form.eventDate,repeatMode:form.repeatMode,
     advanceDays:JSON.parse(data.advance_days_json||'[30,7,1,0]'),
     note:form.note,subjectProfileId:data.subject_profile_id||null}
  case 'routines':{
   const prev=config
   const type=form.repeatType
   const configNext=type==='interval'?{days:form.repeatDays,anchor:form.repeatAnchor}:
     type==='workday'?{weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true}:
     type==='weekly'?{weekdays:Array.isArray(prev.weekdays)?prev.weekdays:[new Date().getDay()],
       excludeJapaneseHolidays:!!prev.excludeJapaneseHolidays}:
     type==='monthly'?{day:prev.day||Number(form.anchorDate.slice(-2))||1}:{}
   return {...common,repeatType:type,repeatConfig:configNext,anchorDate:form.anchorDate,
     assignedTo:data.assigned_to||null,subjectProfileId:data.subject_profile_id||null}
  }
  case 'wishes':
   return {...common,wishType:form.wishType,status:form.status,
     estimatedAmount:form.estimatedAmount,currency:data.currency||'JPY',note:form.note}
  case 'goals':
   return {...common,targetAmount:form.targetAmount,reservedAmount:form.reservedAmount,
     currency:data.currency||'JPY',targetOn:form.targetOn||null,wishId:data.wish_id||null}
  case 'memories':
   return {...common,story:form.story,happenedOn:form.happenedOn,
     linkedType:data.linked_type||null,linkedId:data.linked_id||null}
  case 'trips':
   return {...common,destination:form.destination,startDate:form.startOn||null,
     endDate:form.endOn||null,budgetAmount:form.budgetAmount,status:form.status}
 }
}
async function save(){
 busy.value=true;error.value=''
 try{
  const response=await fetch('/api/'+props.kind+'/'+encodeURIComponent(props.item.id),{
   method:'PATCH',headers:{'content-type':'application/json'},credentials:'same-origin',
   body:JSON.stringify(values())})
  const result=await response.json()
  if(!response.ok)throw Error(result.error==='forbidden'?'只能编辑自己创建的项目':result.error||'保存失败')
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <form class="detail-editor" @submit.prevent="save">
  <b class="detail-editor-title">编辑{{ ({shopping:'购物',routines:'定期任务',anniversaries:'重要日子',wishes:'心愿',goals:'储蓄目标',memories:'回忆',trips:'旅行'} as Record<string,string>)[kind] }}</b>
  <label>名称<input v-model="form.title" required maxlength="150"/></label>
  <template v-if="kind==='shopping'">
   <label>数量<input v-model.number="form.quantity" type="number" min="1" max="9999" required/></label>
  </template>
  <template v-else-if="kind==='anniversaries'">
   <label>日期<input v-model="form.eventDate" type="date" required/></label>
   <label>重复<select v-model="form.repeatMode"><option value="yearly">每年</option><option value="monthly">每月</option><option value="once">一次</option></select></label>
   <label>备注<textarea v-model="form.note" maxlength="1000" rows="2"/></label>
  </template>
  <template v-else-if="kind==='routines'">
   <label>重复频率<select v-model="form.repeatType"><option value="daily">每天</option><option value="workday">工作日（日本祝日除外）</option><option value="weekly">每周（保留原设定星期）</option><option value="monthly">每月</option><option value="interval">间隔</option></select></label>
   <label v-if="form.repeatType==='interval'">间隔天数<input v-model.number="form.repeatDays" type="number" min="1" max="3650"/></label>
   <label v-if="form.repeatType==='interval'">间隔起算<select v-model="form.repeatAnchor"><option value="fixed">原定日期</option><option value="completion">完成日期</option></select></label>
   <label>起始日期<input v-model="form.anchorDate" type="date" required/></label>
  </template>
  <template v-else-if="kind==='wishes'">
   <label>类型<select v-model="form.wishType"><option value="trip">旅行</option><option value="purchase">购物</option><option value="activity">体验</option><option value="other">其他</option></select></label>
   <label>状态<select v-model="form.status"><option value="wished">想做</option><option value="planning">规划中</option><option value="active">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
   <label>预计金额（¥）<input v-model.number="form.estimatedAmount" type="number" min="0"/></label>
   <label>备注<textarea v-model="form.note" rows="2" maxlength="2000"/></label>
  </template>
  <template v-else-if="kind==='goals'">
   <label>目标金额（¥）<input v-model.number="form.targetAmount" type="number" min="1" required/></label>
   <label>已预留金额（¥）<input v-model.number="form.reservedAmount" type="number" min="0"/></label>
   <label>目标日期<input v-model="form.targetOn" type="date"/></label>
  </template>
  <template v-else-if="kind==='memories'">
   <label>发生日期<input v-model="form.happenedOn" type="date" required/></label>
   <label>内容<textarea v-model="form.story" rows="3" maxlength="8000"/></label>
  </template>
  <template v-else-if="kind==='trips'">
   <label>目的地<input v-model="form.destination" maxlength="300"/></label>
   <label>开始日期<input v-model="form.startOn" type="date"/></label>
   <label>结束日期<input v-model="form.endOn" type="date"/></label>
   <label>预算（¥）<input v-model.number="form.budgetAmount" type="number" min="0"/></label>
   <label>状态<select v-model="form.status"><option value="planning">规划中</option><option value="active">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
  </template>
  <label v-if="kind!=='shopping'&&kind!=='trips'">可见范围
   <select v-model="form.visibility"><option value="household">家庭共享</option><option value="private">仅自己</option></select>
  </label>
  <p v-if="error" role="alert" class="edit-error">{{ error }}</p>
  <div class="editor-actions">
   <button class="editor-cancel" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
   <button class="editor-save" :disabled="busy">{{ busy?'保存中…':'保存修改' }}</button>
  </div>
 </form>
</template>
<style scoped>
.detail-editor{margin:12px 0;padding:15px;border:1px solid #d7e8dc;background:#f6faf6;border-radius:12px;display:grid;gap:10px;min-width:0}
.detail-editor-title{font-size:14px}
.detail-editor label{font-size:12px;color:#65796e;display:grid;gap:5px;min-width:0}
.detail-editor :is(input,select,textarea){width:100%;max-width:100%;min-width:0;box-sizing:border-box;border:1px solid #d4e0d6;border-radius:9px;background:#fff;min-height:40px;padding:9px;color:#273e30}
.detail-editor textarea{line-height:1.5;resize:vertical}
.editor-actions{display:flex;justify-content:flex-end;gap:10px}
.editor-actions button{padding:10px 12px;border-radius:10px;border:0;font-size:13px}
.editor-cancel{background:#fff;color:#65806c;border:1px solid #cadace!important}
.editor-save{background:#43866a;color:white;font-weight:700}
.edit-error{color:#af5337;font-size:12px}
</style>
