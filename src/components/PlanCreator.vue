<script setup lang="ts">
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import OneTimeTaskFields from './OneTimeTaskFields.vue'
import {newOneTimeTaskDraft,oneTimeTaskPayload} from '../one-time-task'
import {computed,reactive,ref} from 'vue'
import AppIcon from './AppIcon.vue'
import EditBottomSheet from './EditBottomSheet.vue'

type PlanKind='routine'|'shopping'|'wish'|'goal'|'trip'
const props=defineProps<{profiles:Array<{id:string;displayName:string;type:string;memberUserId?:string|null}>;members?:Array<{id:string;loginName:string;role?:string}>;userId?:string;openOnMount?:boolean;compact?:boolean}>()
const emit=defineEmits<{created:[kind:PlanKind,id:string,unscheduled?:boolean];taskCreated:[]}>()
const choices=[
 {id:'routine',label:'任务／定期计划',icon:'repeat',description:'一次性或循环'},
 {id:'shopping',label:'购物计划',icon:'shopping',description:'购物与数量'},
 {id:'wish',label:'心愿计划',icon:'heart',description:'可关联储值'},
 {id:'goal',label:'储值计划',icon:'wallet',description:'按月、按年或累计'},
 {id:'trip',label:'旅行计划',icon:'plane',description:'日期与预算'}
] as const
const opened=ref(!!props.openOnMount),kind=ref<PlanKind|null>(null),busy=ref(false),error=ref('')
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const form=reactive({
 title:'',visibility:'household',date:today(),repeatType:'once',monthlyMode:'day',
 monthWeekday:2,monthWeekNumbers:[2,4] as number[],monthDays:[Number(today().slice(-2))] as number[],leaveUnscheduled:false,
 intervalDays:7,intervalAnchor:'fixed',weekdays:[new Date(today()+'T00:00:00Z').getUTCDay()] as number[],remindEnabled:true,
 subjectProfileId:'',assignedTo:props.userId||'',shoppingSecond:'',healthRecordType:'other',quantity:1,dueOn:'',
 goalMode:'once',goalStartOn:today(),startOn:today(),
 wishType:'purchase',estimatedAmount:0,targetOn:'',wishRemindEnabled:false,wishRemindAdvanceDays:0,createSavingsGoal:false,
 targetAmount:100000,reservedAmount:0,destination:'',
 startDate:'',endDate:'',budgetAmount:0,
 tripParticipants:props.members?.map(m=>m.id)||[props.userId||''].filter(Boolean)
})
const isPet=computed(()=>props.profiles.some(p=>p.id===form.subjectProfileId&&p.type==='pet'))
const onceDraft=ref(newOneTimeTaskDraft(today(),props.userId))
const oncePet=computed(()=>props.profiles.some(p=>p.id===onceDraft.value.subjectProfileId&&p.type==='pet'))
const selected=computed(()=>choices.find(c=>c.id===kind.value))
function choose(value:PlanKind){kind.value=value;error.value='';form.title='';form.repeatType='once';form.monthlyMode='day';form.monthWeekday=2;form.monthWeekNumbers=[2,4];form.monthDays=[Number(form.date.slice(-2))];form.weekdays=[utcWeekday(form.date)];form.assignedTo=props.userId||'';form.shoppingSecond='';form.visibility='household';form.tripParticipants=props.members?.map(m=>m.id)||[props.userId||''].filter(Boolean);form.wishRemindEnabled=false;form.wishRemindAdvanceDays=0;onceDraft.value=newOneTimeTaskDraft(today(),props.userId)}
function onVisibilityChange(){
 if(form.visibility==='private'){
  if(form.assignedTo!==props.userId)form.assignedTo=props.userId||''
  form.tripParticipants=props.userId?[props.userId]:[]
 }else if(kind.value==='trip'&&!form.tripParticipants.length){
  form.tripParticipants=props.members?.map(m=>m.id)||[props.userId||''].filter(Boolean)
 }
}
function dismiss(){opened.value=false;kind.value=null;error.value='';onceDraft.value=newOneTimeTaskDraft(today(),props.userId)}
function utcWeekday(date:string){return new Date(date+'T00:00:00Z').getUTCDay()}
async function send(path:string,payload:Record<string,unknown>){
 const response=await fetch('/api'+path,{method:'POST',credentials:'same-origin',
  headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(String(data.error||'创建失败'))
 return data
}
async function submit(){
 if(!kind.value||busy.value||!(kind.value==='routine'&&form.repeatType==='once'?onceDraft.value.title:form.title).trim())return
 busy.value=true;error.value=''
 try{
  let result:any
  const common={title:form.title.trim(),visibility:form.visibility}
  if(kind.value==='routine'){
    const details={
      ...common,assignedTo:form.assignedTo||null,subjectProfileId:form.subjectProfileId||null,
      healthRecordType:isPet.value?form.healthRecordType||null:null,
      remindEnabled:form.remindEnabled
    }
    if(form.repeatType==='once'){
      result=await send('/tasks',oneTimeTaskPayload(onceDraft.value,oncePet.value))
      emit('taskCreated')
    }else{
      const config=form.repeatType==='weekly'?{weekdays:[...form.weekdays].sort((a,b)=>a-b)}:
        form.repeatType==='monthly'?(form.monthlyMode==='weekday'?
          {mode:'weekday',weekday:Number(form.monthWeekday),
           weekNumbers:[...form.monthWeekNumbers].sort((a,b)=>a-b)}:
          {mode:'day',days:[...form.monthDays].sort((a,b)=>a-b)}):
        form.repeatType==='interval'?{days:form.intervalDays,anchor:form.intervalAnchor,startOnAnchor:true}:{}
      result=await send('/routines',{...details,assignedTo:null,repeatType:form.repeatType,
        repeatConfig:config,anchorDate:form.date})
    }
  }else if(kind.value==='shopping'){
    result=await send('/shopping',{...common,quantity:form.quantity,dueOn:form.dueOn||null,assignedTo:form.assignedTo||null,secondAssigneeUserId:form.shoppingSecond||null})
  }else if(kind.value==='wish'){
    if(form.createSavingsGoal&&form.estimatedAmount<=0)throw Error('添加关联储值计划时，请填写大于零的预估金额')
    result=await send('/wishes',{...common,wishType:form.wishType,
      estimatedAmount:form.estimatedAmount,currency:'JPY',targetOn:form.targetOn||null,
      remindEnabled:!!form.targetOn&&form.wishRemindEnabled,remindAdvanceDays:form.wishRemindAdvanceDays,
      createSavingsGoal:form.createSavingsGoal,goalStartOn:form.goalStartOn})
  }else if(kind.value==='goal'){
    result=await send('/goals',{...common,targetAmount:form.targetAmount,
      reservedAmount:form.goalMode==='once'?form.reservedAmount:0,
      goalMode:form.goalMode,startOn:form.startOn,
      currency:'JPY',targetOn:form.targetOn||null})
  }else{
    result=await send('/trips',{...common,destination:form.destination,
      startDate:form.startDate||null,endDate:form.endDate||null,
      budgetAmount:form.budgetAmount,participants:form.visibility==='private'?[props.userId]:form.tripParticipants})
  }
  const savedUnscheduled=kind.value==='routine'&&form.repeatType==='once'&&!onceDraft.value.dueOn
  emit('created',kind.value,String(result.id||''),savedUnscheduled)
  dismiss()
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
</script>
<template>
 <section :class="['plan-creator',{compact:props.compact}]">
  <button class="creator-trigger" type="button" :aria-expanded="opened"
    :aria-label="props.compact?'新增计划':undefined" :title="props.compact?'新增计划':undefined"
    @click="opened?dismiss():opened=true">
   <AppIcon name="plus" :size="19"/><span v-if="!props.compact">{{ opened?'收起新增计划':'新增计划' }}</span>
  </button>
  <EditBottomSheet v-if="opened" title="新增计划" :close-disabled="busy" @close="dismiss">
   <h2>选择计划类型</h2>
   <div class="plan-type-grid">
    <button v-for="choice in choices" :key="choice.id" type="button"
     :class="['plan-type',{selected:kind===choice.id}]" :aria-pressed="kind===choice.id" @click="choose(choice.id)">
     <AppIcon :name="choice.icon" :size="21"/>
     <b>{{ choice.label }}</b><small>{{ choice.description }}</small>
    </button>
   </div>
   <form v-if="kind" class="plan-fields" @submit.prevent="submit">
    <h3>{{ selected?.label }}</h3>
    <label v-if="kind!=='routine'||form.repeatType!=='once'">计划名称<input v-model.trim="form.title" required maxlength="150" placeholder="计划名称"/></label>
    <template v-if="kind==='routine'">
     <label>执行频率<select v-model="form.repeatType">
       <option value="once">一次性</option><option value="daily">每天</option>
       <option value="weekly">每周</option><option value="monthly">每月</option>
       <option value="workday">工作日（日本祝日除外）</option>
       <option value="interval">自定义间隔</option>
     </select></label>
     <OneTimeTaskFields v-if="form.repeatType==='once'" v-model="onceDraft" :profiles="profiles" :members="members" :user-id="userId"/>
     <template v-else>
      <label>起始日期<DateField v-model="form.date" required /></label>
      <small class="plan-field-hint">定期任务默认不指派。需要某一期交给家人时，在计划的「···」中选择「指派本期」，并设置正整数奖励。</small>
      <fieldset v-if="form.repeatType==='weekly'" class="day-select-group">
       <legend>每周执行日（可多选）</legend>
       <div class="day-select weekday-select">
        <label v-for="(day,i) in ['日','一','二','三','四','五','六']" :key="i"
         :class="['day-option',{ 'is-selected':form.weekdays.includes(i) }]">
         <input v-model="form.weekdays" type="checkbox" :value="i"/>
         <span>{{ day }}</span>
        </label>
       </div>
       <small v-if="!form.weekdays.length" class="creator-error">请至少选择一个星期</small>
      </fieldset>
      <template v-if="form.repeatType==='monthly'">
       <label>每月按什么执行
        <select v-model="form.monthlyMode" aria-label="每月规则类型">
         <option value="day">指定日期</option>
         <option value="weekday">指定第几个星期几</option>
        </select>
       </label>
       <fieldset v-if="form.monthlyMode==='day'" class="day-select-group">
        <legend>每月执行日期（可多选）</legend>
        <div class="day-select month-day-select">
         <label v-for="n in 31" :key="n"
          :class="['day-option',{ 'is-selected':form.monthDays.includes(n) }]">
          <input v-model="form.monthDays" type="checkbox" :value="n"/>
          <span>{{ n }}</span>
         </label>
        </div>
        <small>月底不存在的日期自动调整为当月最后一天，同一天只执行一次</small>
        <small v-if="!form.monthDays.length" class="creator-error">请至少选择一个日期</small>
       </fieldset>
       <template v-else>
        <label>执行星期
         <select v-model.number="form.monthWeekday" aria-label="每月执行星期">
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
        <small v-if="!form.monthWeekNumbers.length" class="creator-error">请至少选择一个星期序号</small>
       </template>
      </template>
      <template v-if="form.repeatType==='interval'">
       <label>间隔天数<input v-model.number="form.intervalDays" type="number" inputmode="numeric" min="1" max="3650" required/></label>
       <label>计算方式<select v-model="form.intervalAnchor">
        <option value="fixed">按原定日期</option><option value="completion">按上次完成日期</option>
       </select></label>
      </template>
      <label class="plan-checkbox"><input v-model="form.remindEnabled" type="checkbox"/>
       <span>开启提醒</span></label>
      <label>关联家人或宠物（可选）<select v-model="form.subjectProfileId">
       <option value="">不关联</option>
       <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.displayName }}</option>
      </select></label>
      <label v-if="isPet">完成后写入护理记录<select v-model="form.healthRecordType">
       <option value="">不自动记录</option><option value="other">日常护理</option>
       <option value="grooming">梳毛／洗澡</option><option value="medication">用药</option>
       <option value="deworm">驱虫</option><option value="vaccination">疫苗</option>
       <option value="vet">就诊</option>
      </select></label>
     </template>
    </template>
    <template v-else-if="kind==='shopping'">
     <label>数量<input v-model.number="form.quantity" type="number" inputmode="numeric" min="1" max="9999" required/></label>
     <label>计划购买日期（可选）<DateField v-model="form.dueOn" /></label>
     <label>处理人<select v-model="form.assignedTo" aria-label="选择购物处理人"
       @change="form.assignedTo&&form.assignedTo!==userId?form.visibility='household':null;form.shoppingSecond===form.assignedTo?form.shoppingSecond='':null">
       <option value="">未指派</option>
       <option v-for="member in (members||[])" :key="member.id" :value="member.id">
         {{ profiles.find(p=>p.memberUserId===member.id)?.displayName||member.loginName }}{{ member.id===userId?'（我）':'' }}
       </option>
     </select></label>
     <label v-if="form.assignedTo">共同处理人（可选）
       <select v-model="form.shoppingSecond" aria-label="购物共同处理人"
         @change="form.shoppingSecond&&form.shoppingSecond!==userId?form.visibility='household':null">
         <option value="">仅一人</option>
         <option v-for="member in (members||[])" :key="member.id"
           :disabled="member.id===form.assignedTo" :value="member.id">
           {{ profiles.find(p=>p.memberUserId===member.id)?.displayName||member.loginName }}
         </option>
       </select>
       <small v-if="form.shoppingSecond">关联实际消费后两位处理人各得 1 分</small>
     </label>
    </template>
    <template v-else-if="kind==='wish'">
     <label>心愿类型<select v-model="form.wishType">
      <option value="purchase">想买东西</option><option value="trip">想去旅行</option>
      <option value="activity">想体验</option><option value="other">其他</option>
     </select></label>
     <label>预估金额（日元）<MoneyInput v-model="form.estimatedAmount" :min="0" :max="100000000000" required/></label>
     <label>目标日期（可选）<DateField v-model="form.targetOn" /></label>
     <label class="plan-checkbox"><input v-model="form.wishRemindEnabled" type="checkbox" :disabled="!form.targetOn"/> 开启提醒</label>
     <label v-if="form.wishRemindEnabled&&form.targetOn">提醒时间<select v-model.number="form.wishRemindAdvanceDays">
       <option :value="0">到期当天 06:00</option><option :value="1">提前 1 天</option>
       <option :value="3">提前 3 天</option><option :value="7">提前 7 天</option>
     </select></label>
     <label class="plan-checkbox"><input v-model="form.createSavingsGoal" type="checkbox"/>
      <span>同时创建关联的储值计划</span></label>
     <label v-if="form.createSavingsGoal">储值开始日期<DateField v-model="form.goalStartOn" required /></label>
    </template>
    <template v-else-if="kind==='goal'">
     <label>储值方式<select v-model="form.goalMode">
       <option value="once">累计目标（一次性）</option>
       <option value="monthly">每月固定目标</option>
       <option value="yearly">每年固定目标</option>
     </select></label>
     <label>{{ form.goalMode==='monthly'?'每月目标金额':form.goalMode==='yearly'?'每年目标金额':'累计目标金额' }}（日元）
       <MoneyInput v-model="form.targetAmount" :min="1" :max="100000000000" required/></label>
     <label>开始日期<DateField v-model="form.startOn" required /></label>
     <label v-if="form.goalMode==='once'">期初储值额（日元）
       <MoneyInput v-model="form.reservedAmount" :min="0" :max="100000000000" required/></label>
     <label>结束／目标日期（可选）<DateField v-model="form.targetOn" :min="form.startOn||undefined" /></label>
    </template>
    <template v-else-if="kind==='trip'">
     <label>目的地<input v-model.trim="form.destination" maxlength="300" placeholder="例如：上海"/></label>
     <label>出发日期（可选）<DateField v-model="form.startDate" /></label>
     <label>结束日期（可选）<DateField v-model="form.endDate" /></label>
     <label>旅行预算（日元）<MoneyInput v-model="form.budgetAmount" :min="0" :max="100000000000"/></label>
     <fieldset class="trip-participants-field"><legend>参与人</legend>
      <label v-for="member in props.members||[]" :key="member.id" class="trip-participant-option">
       <input v-model="form.tripParticipants" type="checkbox" :value="member.id" :disabled="form.visibility==='private'" />
       <span>{{ props.profiles.find(p=>p.memberUserId===member.id&&p.type==='person')?.displayName||member.loginName }}</span>
      </label>
     </fieldset>

    </template>
    <label v-if="kind!=='routine'||form.repeatType!=='once'">可见范围<select v-model="form.visibility" @change="onVisibilityChange">
     <option value="household">家庭共享</option><option value="private">仅自己</option>
    </select></label>
    <p v-if="error" role="alert" class="creator-error">{{ error }}</p>
    <div class="creator-actions">
     <button type="button" class="creator-cancel" @click="dismiss">取消</button>
     <button class="creator-save" :disabled="busy||(kind==='routine'&&((form.repeatType==='weekly'&&!form.weekdays.length)||(form.repeatType==='monthly'&&!(form.monthlyMode==='weekday'?form.monthWeekNumbers:form.monthDays).length)))">{{ busy?'保存中…':kind==='routine'&&form.repeatType==='once'?'添加任务':'保存计划' }}</button>
    </div>
   </form>
  </EditBottomSheet>
 </section>
</template>
<style scoped>
.plan-creator{padding:0;border:0;background:transparent;border-radius:0;margin:0 0 16px;display:grid;gap:12px}
.plan-creator.compact{margin:0;display:block}
 .plan-creator.compact .creator-trigger{width:44px;height:44px;min-height:44px;min-width:44px;display:grid;place-items:center;
 padding:0;border:1px solid #c9dfcf;border-radius:11px;background:#f3f9f4;color:#3b8364}
.plan-creator.compact .creator-trigger:focus-visible{outline:2px solid #43866a;outline-offset:2px}
.plan-creator h2{font-size:15px;margin:0}.plan-creator h3{margin:0;font-size:14px;color:#2a4c3a}
.creator-trigger{display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:11px;min-height:44px;background:#43866a;color:white;font-size:14px;font-weight:700}
.plan-type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.plan-type{min-height:86px;touch-action:manipulation;border:1px solid #e0e9e1;border-radius:12px;background:#fbfcf9;padding:12px;min-width:0;text-align:left;display:grid;justify-items:start;gap:5px;color:#466e54}
.plan-type.selected{border-color:#43866a;background:#eef7ef}.plan-type b{font-size:13px;color:#314637}.plan-type small{font-size:11px;line-height:1.45;color:#7b9082}
.plan-fields{display:grid;gap:12px;padding-top:12px;border-top:1px solid #e6eee5}
.plan-fields label{display:grid;gap:5px;min-width:0;color:#5d7769;font-size:12px}
.plan-fields input:not([type="checkbox"]),.plan-fields select{width:100%;max-width:100%;min-width:0;min-height:41px;border-radius:9px;padding:8px 10px;border:1px solid #d9e4db;background:#fff;box-sizing:border-box;color:#304838}
.plan-fields .plan-checkbox{display:flex;align-items:center;gap:10px}.plan-checkbox input{width:19px;height:19px;flex:none;accent-color:#43866a}
.plan-checkbox span{min-width:0;color:#314d3e}.plan-checkbox small{display:block;color:#8a9b8e;font-size:11px;line-height:1.45;margin-top:3px}
.monthly-week-select{display:flex;flex-wrap:wrap;gap:7px;min-width:0;margin:0;padding:10px;border:1px solid #d9e4db;border-radius:10px}
.monthly-week-select legend{padding:0 5px;color:#5d7769;font-size:12px}
.plan-fields .monthly-week-option{display:flex;align-items:center;gap:5px;border:1px solid #d9e4db;background:#fff;border-radius:8px;padding:7px 9px}
.monthly-week-option input[type="checkbox"]{width:17px;height:17px;flex:none;accent-color:#43866a}
.day-select-group{min-width:0;margin:0;border:0;padding:0;display:grid;gap:7px}
.day-select-group legend{font-size:12px;color:#5d7769;margin-bottom:6px}
.day-select-group small{font-size:11px;color:#708778}
.day-select{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
.plan-fields .day-option{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:44px;cursor:pointer;border:1px solid #d9e4db;border-radius:9px;background:#fff;color:#466e54;font-size:12px}
.plan-fields .day-option.is-selected{background:#43866a;border-color:#43866a;color:#fff;font-weight:700}
.day-option:focus-within{outline:2px solid #7bbda1;outline-offset:2px}
.day-option input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.trip-participants-field{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:10px;border:1px solid #d9e4db;border-radius:10px;min-width:0;max-width:100%}
.trip-participants-field legend{font-size:12px;color:#5d7769;padding:0 5px}
.plan-fields .trip-participant-option{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:9px;min-width:0;max-width:100%;width:100%;min-height:42px;margin:0;padding:9px 10px;border:1px solid #dce7df;border-radius:10px;background:#fff;cursor:pointer}
.plan-fields .trip-participant-option:has(input:checked){background:#edf6ef;border-color:#91c5a6}
.plan-fields .trip-participant-option:focus-within{outline:2px solid #43866a;outline-offset:2px}
.plan-fields .trip-participant-option>input[type="checkbox"]{display:block;flex:0 0 18px;width:18px;min-width:18px;max-width:18px;height:18px;min-height:18px;max-height:18px;margin:0;padding:0;box-sizing:border-box;accent-color:#43866a}
.plan-fields .trip-participant-option>span{display:block;flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-break:normal;font-size:13px;font-weight:600;line-height:1.4;color:#314d3e}
@media(max-width:350px){.trip-participants-field{grid-template-columns:minmax(0,1fr)}}
.creator-tip{font-size:11px;line-height:1.6;color:#7c9183;margin:0}.creator-error{color:#ad513d;font-size:12px}
.creator-actions{display:flex;gap:9px;justify-content:flex-end}.creator-actions button{min-height:44px;border:0;border-radius:9px;padding:9px 15px}
.creator-cancel{color:#577864;background:#edf3ec}.creator-save{background:#43866a;color:white;font-weight:700}
@media(max-width:380px){.plan-type-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.plan-type{padding:10px 9px}.plan-type small{font-size:10px}}
</style>
