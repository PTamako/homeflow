<script setup lang="ts">
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import {reactive,ref,computed,watch} from 'vue'
import {tripDurationDays,longTripNeedsConfirmation,longTripWarning} from '../trip-reward-confirmation.mjs'
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
 repeatAnchor:String(config.anchor||'fixed'),weekdays:Array.isArray(config.weekdays)?[...config.weekdays] as number[]:[new Date().getDay()] as number[],
 monthlyMode:String(config.mode==='weekday'?'weekday':'day'),
 monthDays:Array.isArray(config.days)?[...config.days] as number[]:[Number(config.day||String(data.anchor_date||'').slice(-2)||1)] as number[],
 monthWeekday:Number(config.weekday??2),
 monthWeekNumbers:Array.isArray(config.weekNumbers)?[...config.weekNumbers] as number[]:[2,4] as number[],
 anchorDate:String(data.anchor_date||''),
 subjectProfileId:String(data.subject_profile_id||''),assignedTo:String(data.assigned_to||''),shoppingSecond:String(data.second_assignee_user_id||''),healthRecordType:String(data.health_record_type||''),
 wishType:String(data.wish_type||'other'),status:String(data.status||'wished'),
 estimatedAmount:Number(data.estimated_amount||0),wishRemindEnabled:data.remind_enabled===1,
 wishRemindAdvanceDays:Number(data.remind_advance_days??0),
 targetAmount:Number(data.target_amount||0),reservedAmount:Number(data.reserved_amount||0),
 goalMode:String(data.goal_mode||'once'),goalStartOn:String(data.start_on||''),
 targetOn:String(data.target_on||''),happenedOn:String(data.happened_on||''),
 story:String(data.story||''),destination:String(data.destination||''),
 startOn:String(data.startOn||data.start_on||''),
 endOn:String(data.endOn||data.end_on||''),budgetAmount:Number(data.budgetAmount||data.budget_amount||0),
 tripParticipants:Array.isArray(data.participants)?[...data.participants] as string[]:[String(data.createdBy||data.created_by||'')].filter(Boolean)
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
   return {...common,quantity:form.quantity,dueOn:form.dueOn||null,assignedTo:form.assignedTo||null,secondAssigneeUserId:form.shoppingSecond||null}
  case 'anniversaries':
   return {...common,eventDate:form.eventDate,repeatMode:form.repeatMode,
     advanceDays:JSON.parse(data.advance_days_json||'[30,7,1,0]'),
     note:form.note,subjectProfileId:data.subject_profile_id||null}
  case 'routines':{
   const prev=config
   const type=form.repeatType
   const configNext=type==='interval'?{days:form.repeatDays,anchor:form.repeatAnchor,
      ...(form.anchorDate!==data.anchor_date||type!==data.repeat_type?
        {startOnAnchor:true}:
        typeof config.startOnAnchor==='boolean'?{startOnAnchor:config.startOnAnchor}:{})}:
     type==='workday'?{weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true}:
     type==='weekly'?{weekdays:[...form.weekdays].sort((a,b)=>a-b),
       excludeJapaneseHolidays:false}:
     type==='monthly'?(form.monthlyMode==='weekday'?
       {mode:'weekday',weekday:Number(form.monthWeekday),
        weekNumbers:[...form.monthWeekNumbers].sort((a,b)=>a-b)}:
       {mode:'day',days:[...form.monthDays].sort((a,b)=>a-b)}):{}
   return {...common,repeatType:type,repeatConfig:configNext,anchorDate:form.anchorDate,
     assignedTo:form.assignedTo||null,subjectProfileId:form.subjectProfileId||null,
     remindEnabled:form.remindEnabled,healthRecordType:routineSubjectIsPet.value?form.healthRecordType||null:null}
  }
  case 'wishes':
   return {...common,wishType:form.wishType,status:form.status,
     estimatedAmount:form.estimatedAmount,currency:data.currency||'JPY',note:form.note,targetOn:form.targetOn||null,
     remindEnabled:!!form.targetOn&&form.wishRemindEnabled,remindAdvanceDays:form.wishRemindAdvanceDays}
  case 'goals':
   return {...common,targetAmount:form.targetAmount,reservedAmount:form.reservedAmount,
     goalMode:form.goalMode,startOn:form.goalStartOn||null,
     currency:data.currency||'JPY',targetOn:form.targetOn||null,wishId:data.wish_id||null}
  case 'memories':
   return {...common,story:form.story,happenedOn:form.happenedOn,
     linkedType:data.linked_type||null,linkedId:data.linked_id||null}
  case 'trips':
   return {...common,destination:form.destination,startDate:form.startOn||null,
     endDate:form.endOn||null,budgetAmount:form.budgetAmount,status:form.status,participants:form.tripParticipants}
 }
}
async function save(){
 busy.value=true;error.value=''
 if(['routines','shopping'].includes(props.kind)&&form.visibility==='private'&&((form.assignedTo&&form.assignedTo!==props.userId)||props.kind==='shopping'&&!!form.shoppingSecond)){
  error.value='指派给其他家庭账号时，请选择家庭共享';busy.value=false;return
 }
 try{
  const completingTrip=props.kind==='trips'&&form.status==='completed'&&data.status!=='completed'
  let longTripConfirmed=false
  if(completingTrip){
    if(!confirm('确定旅行已结束并结算参与人积分吗？'))return
    const days=tripDurationDays(form.startOn,form.endOn)
    if(longTripNeedsConfirmation(days)){
      if(!confirm(longTripWarning(days)))return
      longTripConfirmed=true
    }
  }
  const response=await fetch('/api/'+props.kind+'/'+encodeURIComponent(props.item.id),{
   method:'PATCH',headers:{'content-type':'application/json'},credentials:'same-origin',
   body:JSON.stringify({...values(),...(longTripConfirmed?{longTripConfirmed:true}:{}),
    expectedUpdatedAt:props.item.updated_at||props.item.updatedAt||null,
    ...(['shopping','memories'].includes(props.kind)?{
      expectedSnapshot:JSON.stringify((props.kind==='shopping'?
        ['title','quantity','due_on','completed_at','ledger_entry_id','assigned_to','second_assignee_user_id']:
        ['title','story','happened_on','visibility','linked_type','linked_id'])
        .map(key=>data[key]??null))
    }:{})})})
  const result=await response.json()
  if(!response.ok){
     const messages:Record<string,string>={
       forbidden:'只能编辑自己创建的项目',
       trip_reward_locked_reopen_first:'旅行已结算积分。如需修改日期或参与人，请先撤销完成；已消费的积分可能需要先补足。',
       trip_reward_insufficient_balance:'积分已消费，余额不足以撤销旅行结算。请先补足可用积分。',
       trip_long_confirmation_required:'旅行超过30天，请重新确认旅行日期后再完成。',
       trip_edit_conflict:'该旅行在其他设备已修改，请刷新后重试'
     }
     throw Error(messages[String(result.error)]||result.error||'保存失败')
   }
  emit('saved')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <EditBottomSheet :title="'编辑'+({shopping:'购物计划',routines:'定期任务',anniversaries:'重要日子',wishes:'心愿计划',goals:'储值计划',memories:'回忆',trips:'旅行'} as Record<string,string>)[kind]" :close-disabled="busy" @close="emit('cancel')">
 <form class="detail-editor" @submit.prevent="save">
  <label>名称<input v-model="form.title" required maxlength="150"/></label>
  <template v-if="kind==='shopping'">
   <label>数量<input v-model.number="form.quantity" type="number" min="1" max="9999" required/></label>
   <label>计划购买日<DateField v-model="form.dueOn" /></label>
   <label>处理人
     <select v-model="form.assignedTo" aria-label="修改购物计划处理人"
       @change="form.assignedTo&&form.assignedTo!==userId?form.visibility='household':null;form.shoppingSecond===form.assignedTo?form.shoppingSecond='':null">
       <option value="">未指派</option>
       <option v-for="member in (members||[])" :key="member.id" :value="member.id">
         {{ (profiles||[]).find(p=>p.memberUserId===member.id)?.displayName||member.loginName }}
       </option>
     </select>
   </label>
   <label v-if="form.assignedTo">共同处理人（可选）
     <select v-model="form.shoppingSecond" aria-label="修改购物共同处理人"
       @change="form.shoppingSecond&&form.shoppingSecond!==userId?form.visibility='household':null">
       <option value="">仅一人</option>
       <option v-for="member in (members||[])" :key="member.id"
         :disabled="member.id===form.assignedTo" :value="member.id">
         {{ (profiles||[]).find(p=>p.memberUserId===member.id)?.displayName||member.loginName }}
       </option>
     </select>
   </label>
   <label>可见范围
     <select v-model="form.visibility" aria-label="购物计划可见范围"
       @change="form.visibility==='private'?form.shoppingSecond='':null;form.visibility==='private'&&form.assignedTo!==userId?form.assignedTo=userId||'':null">
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
   <fieldset v-if="form.repeatType==='weekly'" class="day-select-group">
    <legend>每周执行日（可多选）</legend>
    <div class="day-select">
     <label v-for="(day,i) in ['日','一','二','三','四','五','六']" :key="i"
      :class="['day-option',{ 'is-selected':form.weekdays.includes(i) }]">
      <input v-model="form.weekdays" type="checkbox" :value="i"/>
      <span>{{ day }}</span>
     </label>
    </div>
    <small v-if="!form.weekdays.length" class="edit-error">请至少选择一个星期</small>
   </fieldset>
   <template v-if="form.repeatType==='monthly'">
    <label>每月规则
     <select v-model="form.monthlyMode" aria-label="编辑每月规则类型">
      <option value="day">指定日期</option>
      <option value="weekday">指定第几个星期几</option>
     </select>
    </label>
    <fieldset v-if="form.monthlyMode==='day'" class="day-select-group">
     <legend>每月执行日期（可多选）</legend>
     <div class="day-select">
      <label v-for="n in 31" :key="n"
       :class="['day-option',{ 'is-selected':form.monthDays.includes(n) }]">
       <input v-model="form.monthDays" type="checkbox" :value="n"/>
       <span>{{ n }}</span>
      </label>
     </div>
     <small>月底不存在的日期自动调整为当月最后一天，同一天只执行一次</small>
     <small v-if="!form.monthDays.length" class="edit-error">请至少选择一个日期</small>
    </fieldset>
    <template v-else>
     <label>执行星期
      <select v-model.number="form.monthWeekday" aria-label="编辑每月执行星期">
       <option v-for="(day,i) in ['周日','周一','周二','周三','周四','周五','周六']"
        :key="i" :value="i">{{ day }}</option>
      </select>
     </label>
     <fieldset class="monthly-week-select">
      <legend>每月第几个（可多选）</legend>
      <label v-for="n in [1,2,3,4,5]" :key="n" class="monthly-week-option">
       <input v-model="form.monthWeekNumbers" type="checkbox" :value="n"/>
       <span>第 {{ n }} 个</span>
      </label>
     </fieldset>
     <small v-if="!form.monthWeekNumbers.length" class="edit-error">请至少选择一个星期序号</small>
    </template>
   </template>
   <label v-if="form.repeatType==='interval'">间隔天数<input v-model.number="form.repeatDays" type="number" min="1" max="3650"/></label>
   <label v-if="form.repeatType==='interval'">间隔起算<select v-model="form.repeatAnchor"><option value="fixed">原定日期</option><option value="completion">完成日期</option></select></label>
   <label>起始日期<DateField v-model="form.anchorDate" required /></label>
   <small>定期任务的处理人可在每期「指派本期」中单独设置，不影响以后各期。</small>
   <label v-if="form.assignedTo&&form.assignedTo!==userId">原有长期指派<select v-model="form.assignedTo" aria-label="原有长期处理人">
     <option :value="form.assignedTo">{{ members?.find(m=>m.id===form.assignedTo)?.loginName||'原处理人' }}</option>
     <option value="">取消长期指派</option>
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
   <label>预计金额（¥）<MoneyInput v-model="form.estimatedAmount" :min="0"/></label>
   <label>目标日期（可选）<DateField v-model="form.targetOn" /></label>
   <label class="edit-remind"><input v-model="form.wishRemindEnabled" type="checkbox" :disabled="!form.targetOn"/> 开启提醒</label>
   <label v-if="form.wishRemindEnabled&&form.targetOn">提醒时间<select v-model.number="form.wishRemindAdvanceDays">
      <option :value="0">到期当天 06:00</option><option :value="1">提前 1 天</option>
      <option :value="3">提前 3 天</option><option :value="7">提前 7 天</option>
    </select></label>
   <label>备注<textarea v-model="form.note" rows="2" maxlength="2000"/></label>
  </template>
  <template v-else-if="kind==='goals'">
   <label>储值方式<select v-model="form.goalMode">
     <option value="once">累计目标（一次性）</option>
     <option value="monthly">每月固定目标</option>
     <option value="yearly">每年固定目标</option>
   </select></label>
   <label>{{ form.goalMode==='monthly'?'每月目标金额':form.goalMode==='yearly'?'每年目标金额':'累计目标金额' }}（¥）
     <MoneyInput v-model="form.targetAmount" :min="1" required/></label>
   <label>开始日期<DateField v-model="form.goalStartOn" required /></label>
   <label v-if="form.goalMode==='once'">期初储值额（¥）<MoneyInput v-model="form.reservedAmount" :min="0"/></label>
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
   <label>预算（¥）<MoneyInput v-model="form.budgetAmount" :min="0"/></label>
   <fieldset class="trip-participants-field"><legend>参与人</legend>
    <label v-for="member in members||[]" :key="member.id" class="trip-participant-option">
     <input v-model="form.tripParticipants" type="checkbox" :value="member.id" :disabled="form.visibility==='private'"/>
     <span>{{ profiles?.find(p=>p.memberUserId===member.id&&p.type==='person')?.displayName||member.loginName }}</span>
    </label>
   </fieldset>
   <label>状态<select v-model="form.status"><option value="planning">规划中</option><option value="active">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
  </template>
  <label v-if="kind!=='shopping'&&kind!=='trips'">可见范围
   <select v-model="form.visibility"><option value="household">家庭共享</option><option value="private">仅自己</option></select>
  </label>
  <p v-if="error" role="alert" class="edit-error">{{ error }}</p>
  <div class="editor-actions">
   <button class="editor-cancel" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
   <button class="editor-save" :disabled="busy||(kind==='routines'&&((form.repeatType==='weekly'&&!form.weekdays.length)||(form.repeatType==='monthly'&&!(form.monthlyMode==='weekday'?form.monthWeekNumbers:form.monthDays).length)))">{{ busy?'保存中…':'保存修改' }}</button>
  </div>
 </form>
 </EditBottomSheet>
</template>
<style scoped>
.detail-editor{margin:0;padding:0;border:0;background:transparent;display:grid;gap:12px;min-width:0}
.trip-participants-field{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:10px;border:1px solid #d4e0d6;border-radius:10px;min-width:0;max-width:100%}
.trip-participants-field legend{font-size:12px;color:#65796e;padding:0 5px}
.detail-editor .trip-participant-option{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:9px;min-width:0;max-width:100%;width:100%;min-height:42px;margin:0;padding:9px 10px;border:1px solid #dce7df;border-radius:10px;background:#fff;cursor:pointer}
.detail-editor .trip-participant-option:has(input:checked){background:#edf6ef;border-color:#91c5a6}
.detail-editor .trip-participant-option:focus-within{outline:2px solid #43866a;outline-offset:2px}
.detail-editor .trip-participant-option>input[type="checkbox"]{display:block;flex:0 0 18px;width:18px;min-width:18px;max-width:18px;height:18px;min-height:18px;max-height:18px;margin:0;padding:0;border-radius:5px;box-sizing:border-box;accent-color:#43866a}
.detail-editor .trip-participant-option>span{display:block;flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-break:normal;font-size:13px;font-weight:600;line-height:1.4;color:#314d3e}
@media(max-width:350px){.trip-participants-field{grid-template-columns:minmax(0,1fr)}}
.detail-editor-title{font-size:14px}
.detail-editor label{font-size:12px;color:#65796e;display:grid;gap:5px;min-width:0}
.detail-editor :is(input,select,textarea){width:100%;max-width:100%;min-width:0;box-sizing:border-box;border:1px solid #d4e0d6;border-radius:9px;background:#fff;min-height:40px;padding:9px;color:#273e30}
.detail-editor .edit-remind{display:flex;align-items:center;gap:9px}
.detail-editor .edit-remind input[type=checkbox]{width:18px;height:18px;min-height:18px;flex:none}
.detail-editor .monthly-week-select{display:flex;flex-wrap:wrap;gap:7px;min-width:0;margin:0;padding:10px;border:1px solid #d4e0d6;border-radius:10px}
.detail-editor .monthly-week-select legend{padding:0 5px;font-size:12px;color:#65796e}
.detail-editor .monthly-week-option{display:flex;align-items:center;gap:5px;border:1px solid #d4e0d6;background:#fff;border-radius:8px;padding:7px 9px}
.detail-editor .monthly-week-option input[type="checkbox"]{width:17px;height:17px;min-height:17px;padding:0;flex:none;accent-color:#43866a}
.detail-editor .day-select-group{min-width:0;padding:0;margin:0;border:0;display:grid;gap:7px}
.detail-editor .day-select-group legend{font-size:12px;color:#65796e;margin-bottom:6px}
.detail-editor .day-select-group small{font-size:11px;color:#708778}
.detail-editor .day-select{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
.detail-editor .day-option{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:36px;cursor:pointer;border:1px solid #d4e0d6;border-radius:9px;background:#fff;color:#466e54;font-size:12px}
.detail-editor .day-option.is-selected{background:#43866a;border-color:#43866a;color:#fff;font-weight:700}
.detail-editor .day-option:focus-within{outline:2px solid #7bbda1;outline-offset:2px}
.detail-editor .day-option input{position:absolute;opacity:0;width:1px;height:1px;min-height:1px;padding:0;pointer-events:none}
.detail-editor textarea{line-height:1.5;resize:vertical}
.editor-actions{display:flex;justify-content:flex-end;gap:10px}
.editor-actions button{padding:10px 12px;border-radius:10px;border:0;font-size:13px}
.editor-cancel{background:#fff;color:#65806c;border:1px solid #cadace!important}
.editor-save{background:#43866a;color:white;font-weight:700}
.edit-error{color:#af5337;font-size:12px}
</style>
