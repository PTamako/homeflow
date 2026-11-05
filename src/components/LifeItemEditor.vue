<script setup lang="ts">
import DateField from './DateField.vue'
import {reactive,ref,computed,watch} from 'vue'
type Kind='routines'|'anniversaries'|'wishes'|'goals'|'shopping'|'memories'|'trips'
type Item=Record<string,any>
const props=defineProps<{kind:Kind;item:Item;profiles?:Array<{id:string;displayName:string;type:string;memberUserId?:string|null}>;members?:Array<{id:string;loginName:string;role?:string}>;userId?:string}>()
const emit=defineEmits<{saved:[];cancel:[]}>()
const busy=ref(false),error=ref('')
const data=props.item
const config=(()=>{try{return typeof data.repeat_config==='string'?JSON.parse(data.repeat_config):data.repeat_config||{}}catch{return {}}})()
const mode=data.repeat_type==='weekly'&&config.excludeJapaneseHolidays?'workday':data.repeat_type
const form=reactive({
 title:String(data.title||''),visibility:String(data.visibility||'household'),
 quantity:Number(data.quantity||1),dueOn:String(data.due_on||''),remindEnabled:data.remind_enabled!==0,
 eventDate:String(data.event_date||''),
 repeatMode:String(data.repeat_mode||'yearly'),note:String(data.note||''),
 repeatType:String(mode||'daily'),repeatDays:Number(config.days||7),
 repeatAnchor:String(config.anchor||'fixed'),weekday:Number(config.weekdays?.[0]??new Date().getDay()),anchorDate:String(data.anchor_date||''),
 subjectProfileId:String(data.subject_profile_id||''),assignedTo:String(data.assigned_to||''),healthRecordType:String(data.health_record_type||''),
 wishType:String(data.wish_type||'other'),status:String(data.status||'wished'),
 estimatedAmount:Number(data.estimated_amount||0),
 targetAmount:Number(data.target_amount||0),reservedAmount:Number(data.reserved_amount||0),
 goalMode:String(data.goal_mode||'once'),goalStartOn:String(data.start_on||''),
 targetOn:String(data.target_on||''),happenedOn:String(data.happened_on||''),
 story:String(data.story||''),destination:String(data.destination||''),
 startOn:String(data.startOn||data.start_on||''),
 endOn:String(data.endOn||data.end_on||''),budgetAmount:Number(data.budgetAmount||data.budget_amount||0)
})
const routineSubjectIsPet=computed(()=>props.profiles?.some(p=>p.id===form.subjectProfileId&&p.type==='pet')||false)
watch(()=>form.subjectProfileId,(id,previous)=>{
 if(!routineSubjectIsPet.value)form.healthRecordType=''
 else if(id!==previous&&!form.healthRecordType)form.healthRecordType='other'
})
function values(){
 const common={title:form.title.trim(),visibility:form.visibility}
 if(!common.title||common.title.length>150)throw Error('名称须为 1～150 个字符')
 switch(props.kind){
  case 'shopping':
   return {...common,quantity:form.quantity,dueOn:form.dueOn||null,assignedTo:form.assignedTo||null}
  case 'anniversaries':
   return {...common,eventDate:form.eventDate,repeatMode:form.repeatMode,
     advanceDays:JSON.parse(data.advance_days_json||'[30,7,1,0]'),
     note:form.note,subjectProfileId:data.subject_profile_id||null}
  case 'routines':{
   const prev=config
   const type=form.repeatType
   const configNext=type==='interval'?{days:form.repeatDays,anchor:form.repeatAnchor}:
     type==='workday'?{weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true}:
     type==='weekly'?{weekdays:[Number(form.weekday)],
       excludeJapaneseHolidays:!!prev.excludeJapaneseHolidays}:
     type==='monthly'?{day:prev.day||Number(form.anchorDate.slice(-2))||1}:{}
   return {...common,repeatType:type,repeatConfig:configNext,anchorDate:form.anchorDate,
     assignedTo:form.assignedTo||null,subjectProfileId:form.subjectProfileId||null,
     remindEnabled:form.remindEnabled,healthRecordType:routineSubjectIsPet.value?form.healthRecordType||null:null}
  }
  case 'wishes':
   return {...common,wishType:form.wishType,status:form.status,
     estimatedAmount:form.estimatedAmount,currency:data.currency||'JPY',note:form.note,targetOn:form.targetOn||null}
  case 'goals':
   return {...common,targetAmount:form.targetAmount,reservedAmount:form.reservedAmount,
     goalMode:form.goalMode,startOn:form.goalStartOn||null,
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
 if(['routines','shopping'].includes(props.kind)&&form.visibility==='private'&&form.assignedTo&&form.assignedTo!==props.userId){
  error.value='指派给其他家庭账号时，请选择家庭共享';busy.value=false;return
 }
 try{
  const response=await fetch('/api/'+props.kind+'/'+encodeURIComponent(props.item.id),{
   method:'PATCH',headers:{'content-type':'application/json'},credentials:'same-origin',
   body:JSON.stringify({...values(),expectedUpdatedAt:props.item.updated_at||props.item.updatedAt||null,
    ...(['shopping','memories'].includes(props.kind)?{
      expectedSnapshot:JSON.stringify((props.kind==='shopping'?
        ['title','quantity','due_on','completed_at','ledger_entry_id','assigned_to']:
        ['title','story','happened_on','visibility','linked_type','linked_id'])
        .map(key=>data[key]??null))
    }:{})})})
  const result=await response.json()
  if(!response.ok)throw Error(result.error==='forbidden'?'只能编辑自己创建的项目':result.error||'保存失败')
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <form class="detail-editor" @submit.prevent="save">
  <b class="detail-editor-title">编辑{{ ({shopping:'购物计划',routines:'定期任务',anniversaries:'重要日子',wishes:'心愿计划',goals:'储值计划',memories:'回忆',trips:'旅行'} as Record<string,string>)[kind] }}</b>
  <label>名称<input v-model="form.title" required maxlength="150"/></label>
  <template v-if="kind==='shopping'">
   <label>数量<input v-model.number="form.quantity" type="number" min="1" max="9999" required/></label>
   <label>计划购买日<DateField v-model="form.dueOn" /></label>
   <label>处理人
     <select v-model="form.assignedTo" aria-label="修改购物计划处理人"
       @change="form.assignedTo&&form.assignedTo!==userId?form.visibility='household':null">
       <option value="">未指派</option>
       <option v-for="member in (members||[])" :key="member.id" :value="member.id">
         {{ (profiles||[]).find(p=>p.memberUserId===member.id)?.displayName||member.loginName }}
       </option>
     </select>
   </label>
   <label>可见范围
     <select v-model="form.visibility" aria-label="购物计划可见范围"
       @change="form.visibility==='private'&&form.assignedTo!==userId?form.assignedTo=userId||'':null">
       <option value="household">家庭共享</option>
       <option value="private">仅自己</option>
     </select>
   </label>
  </template>
  <template v-else-if="kind==='anniversaries'">
   <label>日期<DateField v-model="form.eventDate" required /></label>
   <label>重复<select v-model="form.repeatMode"><option value="yearly">每年</option><option value="monthly">每月</option><option value="once">一次</option></select></label>
   <label>备注<textarea v-model="form.note" maxlength="1000" rows="2"/></label>
  </template>
  <template v-else-if="kind==='routines'">
   <label>重复频率<select v-model="form.repeatType"><option value="daily">每天</option><option value="workday">工作日（日本祝日除外）</option><option value="weekly">每周（保留原设定星期）</option><option value="monthly">每月</option><option value="interval">间隔</option></select></label>
   <label v-if="form.repeatType==='weekly'">每周执行日<select v-model.number="form.weekday" aria-label="每周执行星期">
     <option v-for="(day,i) in ['周日','周一','周二','周三','周四','周五','周六']" :key="i" :value="i">{{ day }}</option>
   </select></label>
   <label v-if="form.repeatType==='interval'">间隔天数<input v-model.number="form.repeatDays" type="number" min="1" max="3650"/></label>
   <label v-if="form.repeatType==='interval'">间隔起算<select v-model="form.repeatAnchor"><option value="fixed">原定日期</option><option value="completion">完成日期</option></select></label>
   <label>起始日期<DateField v-model="form.anchorDate" required /></label>
   <label>处理人<select v-model="form.assignedTo" aria-label="修改定期任务处理人">
    <option value="">未指派</option>
    <option v-for="member in (members||[])" :key="member.id" :value="member.id" :disabled="form.visibility==='private'&&member.id!==userId">{{ member.loginName }}</option>
   </select></label>
   <label class="edit-remind"><input v-model="form.remindEnabled" type="checkbox"/> 开启提醒</label>
   <label>关联对象（可选）
    <select v-model="form.subjectProfileId" aria-label="选择关联的家庭成员或宠物">
     <option value="">不关联任何人或宠物</option>
     <option v-for="p in (profiles||[])" :key="p.id" :value="p.id">{{ p.displayName }}（{{ p.type==='pet'?'宠物':'家人' }}）</option>
    </select>
   </label>
   <label v-if="routineSubjectIsPet">勾选完成后同步到护理记录
    <select v-model="form.healthRecordType" aria-label="护理记录同步类型">
     <option value="">不自动记录</option><option value="other">日常护理</option>
     <option value="grooming">梳毛／洗澡</option><option value="medication">用药</option>
     <option value="deworm">驱虫</option><option value="vaccination">疫苗</option>
     <option value="vet">就诊</option>
    </select>
   </label>
  </template>
  <template v-else-if="kind==='wishes'">
   <label>类型<select v-model="form.wishType"><option value="trip">旅行</option><option value="purchase">购物</option><option value="activity">体验</option><option value="other">其他</option></select></label>
   <label>状态<select v-model="form.status"><option value="wished">想做</option><option value="planning">规划中</option><option value="active">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
   <label>预计金额（¥）<input v-model.number="form.estimatedAmount" type="number" min="0"/></label>
   <label>目标日期（可选）<DateField v-model="form.targetOn" /></label>
   <label>备注<textarea v-model="form.note" rows="2" maxlength="2000"/></label>
  </template>
  <template v-else-if="kind==='goals'">
   <label>储值方式<select v-model="form.goalMode">
     <option value="once">累计目标（一次性）</option>
     <option value="monthly">每月固定目标</option>
     <option value="yearly">每年固定目标</option>
   </select></label>
   <label>{{ form.goalMode==='monthly'?'每月目标金额':form.goalMode==='yearly'?'每年目标金额':'累计目标金额' }}（¥）
     <input v-model.number="form.targetAmount" type="number" min="1" required/></label>
   <label>开始日期<DateField v-model="form.goalStartOn" required /></label>
   <label v-if="form.goalMode==='once'">期初储值额（¥）<input v-model.number="form.reservedAmount" type="number" min="0"/></label>
   <label>结束／目标日期（可选）<DateField v-model="form.targetOn" :min="form.goalStartOn||undefined" /></label>
   
  </template>
  <template v-else-if="kind==='memories'">
   <label>发生日期<DateField v-model="form.happenedOn" required /></label>
   <label>内容<textarea v-model="form.story" rows="3" maxlength="8000"/></label>
  </template>
  <template v-else-if="kind==='trips'">
   <label>目的地<input v-model="form.destination" maxlength="300"/></label>
   <label>开始日期<DateField v-model="form.startOn" /></label>
   <label>结束日期<DateField v-model="form.endOn" /></label>
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
.detail-editor .edit-remind{display:flex;align-items:center;gap:9px}
.detail-editor .edit-remind input[type=checkbox]{width:18px;height:18px;min-height:18px;flex:none}
.detail-editor textarea{line-height:1.5;resize:vertical}
.editor-actions{display:flex;justify-content:flex-end;gap:10px}
.editor-actions button{padding:10px 12px;border-radius:10px;border:0;font-size:13px}
.editor-cancel{background:#fff;color:#65806c;border:1px solid #cadace!important}
.editor-save{background:#43866a;color:white;font-weight:700}
.edit-error{color:#af5337;font-size:12px}
</style>
