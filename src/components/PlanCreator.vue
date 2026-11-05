<script setup lang="ts">
import DateField from './DateField.vue'
import OneTimeTaskFields from './OneTimeTaskFields.vue'
import {newOneTimeTaskDraft,oneTimeTaskPayload} from '../one-time-task'
import {computed,reactive,ref} from 'vue'
import AppIcon from './AppIcon.vue'

type PlanKind='routine'|'shopping'|'wish'|'goal'|'trip'
const props=defineProps<{profiles:Array<{id:string;displayName:string;type:string}>;members?:Array<{id:string;loginName:string;role?:string}>;userId?:string;openOnMount?:boolean}>()
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
 title:'',visibility:'household',date:today(),repeatType:'once',leaveUnscheduled:false,
 intervalDays:7,intervalAnchor:'fixed',weekday:new Date(today()+'T00:00:00Z').getUTCDay(),remindEnabled:true,
 subjectProfileId:'',assignedTo:props.userId||'',healthRecordType:'other',quantity:1,dueOn:'',
 goalMode:'once',goalStartOn:today(),startOn:today(),
 wishType:'purchase',estimatedAmount:0,targetOn:'',createSavingsGoal:false,
 targetAmount:100000,reservedAmount:0,destination:'',
 startDate:'',endDate:'',budgetAmount:0
})
const isPet=computed(()=>props.profiles.some(p=>p.id===form.subjectProfileId&&p.type==='pet'))
const onceDraft=ref(newOneTimeTaskDraft(today(),props.userId))
const oncePet=computed(()=>props.profiles.some(p=>p.id===onceDraft.value.subjectProfileId&&p.type==='pet'))
const selected=computed(()=>choices.find(c=>c.id===kind.value))
function choose(value:PlanKind){kind.value=value;error.value='';form.title='';form.repeatType='once';onceDraft.value=newOneTimeTaskDraft(today(),props.userId)}
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
      const config=form.repeatType==='weekly'?{weekdays:[Number(form.weekday)]}:
        form.repeatType==='monthly'?{day:Number(form.date.slice(-2))}:
        form.repeatType==='interval'?{days:form.intervalDays,anchor:form.intervalAnchor}:{}
      result=await send('/routines',{...details,repeatType:form.repeatType,
        repeatConfig:config,anchorDate:form.date})
    }
  }else if(kind.value==='shopping'){
    result=await send('/shopping',{...common,quantity:form.quantity,dueOn:form.dueOn||null})
  }else if(kind.value==='wish'){
    if(form.createSavingsGoal&&form.estimatedAmount<=0)throw Error('添加关联储值计划时，请填写大于零的预估金额')
    result=await send('/wishes',{...common,wishType:form.wishType,
      estimatedAmount:form.estimatedAmount,currency:'JPY',targetOn:form.targetOn||null,
      createSavingsGoal:form.createSavingsGoal,goalStartOn:form.goalStartOn})
  }else if(kind.value==='goal'){
    result=await send('/goals',{...common,targetAmount:form.targetAmount,
      reservedAmount:form.goalMode==='once'?form.reservedAmount:0,
      goalMode:form.goalMode,startOn:form.startOn,
      currency:'JPY',targetOn:form.targetOn||null})
  }else{
    result=await send('/trips',{...common,destination:form.destination,
      startDate:form.startDate||null,endDate:form.endDate||null,
      budgetAmount:form.budgetAmount})
  }
  const savedUnscheduled=kind.value==='routine'&&form.repeatType==='once'&&!onceDraft.value.dueOn
  emit('created',kind.value,String(result.id||''),savedUnscheduled)
  dismiss()
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
</script>
<template>
 <section class="plan-creator">
  <button class="creator-trigger" type="button" :aria-expanded="opened" @click="opened?dismiss():opened=true">
   <AppIcon name="plus" :size="19"/> {{ opened?'收起新增计划':'＋ 新增计划' }}
  </button>
  <template v-if="opened">
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
      <label>处理人<select v-model="form.assignedTo" @change="form.assignedTo&&form.assignedTo!==userId?form.visibility='household':null">
       <option value="">未指派</option>
       <option v-for="member in (members||[])" :key="member.id" :value="member.id">{{ member.loginName }}{{ member.id===userId?'（我）':'' }}</option>
      </select></label>
      <label v-if="form.repeatType==='weekly'">每周执行日
       <select v-model.number="form.weekday" aria-label="每周执行星期">
        <option v-for="(day,i) in ['周日','周一','周二','周三','周四','周五','周六']" :key="i" :value="i">{{ day }}</option>
       </select>
      </label>
      <template v-if="form.repeatType==='interval'">
       <label>间隔天数<input v-model.number="form.intervalDays" type="number" min="1" max="3650" required/></label>
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
     <label>数量<input v-model.number="form.quantity" type="number" min="1" max="9999" required/></label>
     <label>计划购买日期（可选）<DateField v-model="form.dueOn" /></label>

    </template>
    <template v-else-if="kind==='wish'">
     <label>心愿类型<select v-model="form.wishType">
      <option value="purchase">想买东西</option><option value="trip">想去旅行</option>
      <option value="activity">想体验</option><option value="other">其他</option>
     </select></label>
     <label>预估金额（日元）<input v-model.number="form.estimatedAmount" type="number" min="0" max="100000000000" required/></label>
     <label>目标日期（可选）<DateField v-model="form.targetOn" /></label>
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
       <input v-model.number="form.targetAmount" type="number" min="1" max="100000000000" required/></label>
     <label>开始日期<DateField v-model="form.startOn" required /></label>
     <label v-if="form.goalMode==='once'">期初储值额（日元）
       <input v-model.number="form.reservedAmount" type="number" min="0" max="100000000000" required/></label>
     <label>结束／目标日期（可选）<DateField v-model="form.targetOn" :min="form.startOn||undefined" /></label>
    </template>
    <template v-else-if="kind==='trip'">
     <label>目的地<input v-model.trim="form.destination" maxlength="300" placeholder="例如：上海"/></label>
     <label>出发日期（可选）<DateField v-model="form.startDate" /></label>
     <label>结束日期（可选）<DateField v-model="form.endDate" /></label>
     <label>旅行预算（日元）<input v-model.number="form.budgetAmount" type="number" min="0" max="100000000000"/></label>

    </template>
    <label v-if="kind!=='routine'||form.repeatType!=='once'">可见范围<select v-model="form.visibility" @change="form.visibility==='private'&&form.assignedTo!==userId?form.assignedTo=userId||'':null">
     <option value="household">家庭共享</option><option value="private">仅自己</option>
    </select></label>
    <p v-if="error" role="alert" class="creator-error">{{ error }}</p>
    <div class="creator-actions">
     <button type="button" class="creator-cancel" @click="dismiss">取消</button>
     <button class="creator-save" :disabled="busy">{{ busy?'保存中…':kind==='routine'&&form.repeatType==='once'?'添加任务':'保存计划' }}</button>
    </div>
   </form>
  </template>
 </section>
</template>
<style scoped>
.plan-creator{padding:15px;border:1px solid #d9e9dc;background:#fff;border-radius:17px;margin:0 0 16px;display:grid;gap:12px}
.plan-creator h2{font-size:15px;margin:0}.plan-creator h3{margin:0;font-size:14px;color:#2a4c3a}
.creator-trigger{display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:11px;min-height:44px;background:#43866a;color:white;font-size:14px;font-weight:700}
.plan-type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.plan-type{border:1px solid #e0e9e1;border-radius:12px;background:#fbfcf9;padding:12px;min-width:0;text-align:left;display:grid;justify-items:start;gap:5px;color:#466e54}
.plan-type.selected{border-color:#43866a;background:#eef7ef}.plan-type b{font-size:13px;color:#314637}.plan-type small{font-size:11px;line-height:1.45;color:#7b9082}
.plan-fields{display:grid;gap:10px;padding-top:12px;border-top:1px solid #e6eee5}
.plan-fields label{display:grid;gap:5px;min-width:0;color:#5d7769;font-size:12px}
.plan-fields input:not([type="checkbox"]),.plan-fields select{width:100%;max-width:100%;min-width:0;min-height:41px;border-radius:9px;padding:8px 10px;border:1px solid #d9e4db;background:#fff;box-sizing:border-box;color:#304838}
.plan-fields .plan-checkbox{display:flex;align-items:center;gap:10px}.plan-checkbox input{width:19px;height:19px;flex:none;accent-color:#43866a}
.plan-checkbox span{min-width:0;color:#314d3e}.plan-checkbox small{display:block;color:#8a9b8e;font-size:11px;line-height:1.45;margin-top:3px}
.creator-tip{font-size:11px;line-height:1.6;color:#7c9183;margin:0}.creator-error{color:#ad513d;font-size:12px}
.creator-actions{display:flex;gap:9px;justify-content:flex-end}.creator-actions button{min-height:42px;border:0;border-radius:9px;padding:9px 15px}
.creator-cancel{color:#577864;background:#edf3ec}.creator-save{background:#43866a;color:white;font-weight:700}
@media(max-width:380px){.plan-type-grid{grid-template-columns:minmax(0,1fr)}}
</style>
