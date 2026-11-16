<script setup lang="ts">
import {ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import BackupPanel from './BackupPanel.vue'
import SecurityPanel from './SecurityPanel.vue'
import ApprovalCenter from './ApprovalCenter.vue'
import CrossMemberTransferConsents from './CrossMemberTransferConsents.vue'
import RecurringFinancePolicyCenter from './RecurringFinancePolicyCenter.vue'
import TrashPanel from './TrashPanel.vue'
import PushPanel from './PushPanel.vue'
import StatusBadge from './StatusBadge.vue'
import ImportantReminders from './ImportantReminders.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'

const props=defineProps<{active:boolean;userId:string;loginName:string;members?:Array<{id:string;loginName:string}>;profiles?:Array<{memberUserId:string|null;displayName:string}>;isOwner:boolean;todayDate:string;todayEntryKeys:string[]}>()
const emit=defineEmits<{logout:[]}>()
const section=ref<'personal'|'family'>('personal')
const approvalSection=ref<'requests'|'recurring'>('requests')
const invitation=ref(''),inviting=ref(false),inviteError=ref('')
const reminderRulesOpen=ref(false)
const pushStatus=ref<'enabled'|'disabled'|'unavailable'|null>(null)
const {toast,notify}=usePageToast()
// An invitation is a bearer credential. Clear its visible value when leaving
// Management; fetching or creating a new one always requires an explicit tap.
watch(()=>props.active,active=>{
 if(!active){invitation.value='';inviteError.value=''}
 if(!active)pushStatus.value=null
 if(!active)reminderRulesOpen.value=false
 if(!active){section.value='personal';approvalSection.value='requests'}
})
watch(()=>props.isOwner,isOwner=>{
 if(!isOwner){section.value='personal';approvalSection.value='requests'}
})
watch(section,value=>{
 if(value!=='family'){invitation.value='';inviteError.value=''}
})
async function generateInvite(){
 if(!props.isOwner||inviting.value)return
 inviting.value=true;inviteError.value='';invitation.value=''
 try{
  const response=await fetch('/api/auth/invitations',{
   method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
   body:'{}',cache:'no-store'
  })
  const result=await response.json()
  if(!response.ok)throw Error(result?.error||'生成邀请码失败')
  invitation.value=String(result.invitationCode||'')
  if(!invitation.value)throw Error('未收到邀请码')
  notify('已生成一次性邀请码')
 }catch(e){inviteError.value=(e as Error).message}
 finally{inviting.value=false}
}
</script>

<template>
 <div class="management-page" aria-label="HomeFlow 管理">
   <nav class="management-tabs" role="tablist" aria-label="管理分类">
     <button id="management-personal-tab" type="button" role="tab"
       :class="['management-tab',{selected:section==='personal'}]"
       :aria-selected="section==='personal'" aria-controls="management-personal-panel"
       @click="section='personal'">个人</button>
     <button v-if="isOwner" id="management-family-tab" type="button" role="tab"
       :class="['management-tab',{selected:section==='family'}]"
       :aria-selected="section==='family'" aria-controls="management-family-panel"
       @click="section='family'">家庭</button>
   </nav>

   <div v-if="section==='personal'" id="management-personal-panel" role="tabpanel"
     aria-labelledby="management-personal-tab" class="management-tab-content">
     <section class="panel">
       <div class="management-section-heading"><AppIcon name="users" :size="20"/><h2>个人账号</h2></div>
       <p class="management-account">当前账号：<b>{{ loginName }}</b></p>
       <SecurityPanel v-if="active" :login-name="loginName"/>
     </section>
     <template v-if="!isOwner">
       <section class="panel">
         <div class="management-section-heading"><AppIcon name="handshake" :size="20"/><h2>我的待确认</h2></div>
         <p class="hint">仅处理需要你本人确认、拒绝或撤回的申请；家庭管理员的审批权限不在此开放。</p>
       </section>
       <ApprovalCenter v-if="active" :active="active" :user-id="userId"
         :is-owner="isOwner" :members="members" :profiles="profiles"/>
       <CrossMemberTransferConsents v-if="active" :active="active" :user-id="userId"
         :is-owner="isOwner" :members="members" :profiles="profiles"/>
       <RecurringFinancePolicyCenter v-if="active" :active="active" :user-id="userId"
         :is-owner="isOwner" :members="members" :profiles="profiles"/>
     </template>
     <section class="panel">
       <div class="management-section-heading"><AppIcon name="bell" :size="20"/><h2>通知设置</h2><StatusBadge v-if="pushStatus" :code="pushStatus"/></div>
       <PushPanel v-if="active" :user-id="userId" :members="members" @status="pushStatus=$event"/>
       <button type="button" class="reminder-rules-trigger"
         :aria-expanded="reminderRulesOpen" @click="reminderRulesOpen=!reminderRulesOpen">
         <span>分类提醒规则</span>
         <span aria-hidden="true">设置</span>
       </button>
       <EditBottomSheet v-if="active&&reminderRulesOpen" title="分类提醒规则" @close="reminderRulesOpen=false">
         <ImportantReminders :today-date="todayDate" :today-entry-keys="todayEntryKeys" compact mode="settings"/>
       </EditBottomSheet>
     </section>
     <section class="panel">
       <div class="management-section-heading"><AppIcon name="archive" :size="20"/><h2>数据管理</h2></div>
       <TrashPanel v-if="active"/>
       <p class="hint">已删除的内容可从回收箱恢复。</p>
     </section>
     <BackupPanel v-if="active" :user-id="userId"/>
     <section class="panel">
       <div class="management-app-actions">
         <button type="button" class="management-logout" @click="emit('logout')">退出登录</button>
       </div>
     </section>
   </div>

   <div v-else-if="isOwner" id="management-family-panel" role="tabpanel"
     aria-labelledby="management-family-tab" class="management-tab-content">
     <section class="panel">
       <div class="management-section-heading"><AppIcon name="users" :size="20"/><h2>家庭成员管理</h2></div>
       <p class="hint">仅家庭管理员可使用此页面；每位成员仍须亲自完成本人同意的步骤。</p>
       <div v-if="isOwner" class="management-family-invites">
         <h3>邀请家庭成员</h3>
         <p class="hint">邀请码 7 天有效，家庭最多 2 位成员。</p>
         <button type="button" class="outline" :disabled="inviting" @click="generateInvite">
           {{ inviting?'生成中…':'生成邀请码' }}
         </button>
         <p v-if="inviteError" role="alert" class="error">{{ inviteError }}</p>
         <div v-if="invitation" class="management-invite-code">
           <code>{{ invitation }}</code><small>请私下发送给家人</small>
         </div>
       </div>
     </section>
     <section class="panel management-family-approval-hub" aria-label="家庭审批">
       <div class="management-section-heading">
         <AppIcon name="clipboard-check" :size="20"/><h2>家庭审批</h2>
       </div>
       <div class="management-approval-tabs" role="tablist" aria-label="家庭审批类型">
         <button type="button" id="family-approval-requests-tab" role="tab"
           :aria-selected="approvalSection==='requests'" aria-controls="family-approval-requests-panel"
           :class="['management-approval-tab',{selected:approvalSection==='requests'}]"
           @click="approvalSection='requests'">一般申请</button>
         <button type="button" id="family-approval-recurring-tab" role="tab"
           :aria-selected="approvalSection==='recurring'" aria-controls="family-approval-recurring-panel"
           :class="['management-approval-tab',{selected:approvalSection==='recurring'}]"
           @click="approvalSection='recurring'">周期计划</button>
       </div>
       <div v-if="approvalSection==='requests'" id="family-approval-requests-panel"
         role="tabpanel" aria-labelledby="family-approval-requests-tab" class="management-approval-body">
         <ApprovalCenter v-if="active&&isOwner" :active="active" :user-id="userId"
           :is-owner="isOwner" :members="members" :profiles="profiles"/>
       </div>
       <div v-else id="family-approval-recurring-panel" role="tabpanel"
         aria-labelledby="family-approval-recurring-tab" class="management-approval-body">
         <p class="hint">丈夫建立固定费或 SBI 定投计划时，管理员只需批准一次。
           在额度、日期、账户和有效期间不变的情况下，无需每月重复批准；
           每期仍须凭实际发生凭证单独记账。修改条件须重新授权。</p>
         <RecurringFinancePolicyCenter v-if="active&&isOwner" :active="active" :user-id="userId"
           :is-owner="isOwner" :members="members" :profiles="profiles"/>
       </div>
     </section>
     <CrossMemberTransferConsents v-if="active&&isOwner" :active="active" :user-id="userId"
       :is-owner="isOwner" :members="members" :profiles="profiles"/>
   </div>
   <PageToast :toast="toast"/>
 </div>
</template>
<style scoped>
.management-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:4px;
  margin:0 0 16px;background:#e8f0e9;border-radius:14px}
.management-tab{min-width:0;min-height:44px;padding:10px 12px;border:0;
  background:transparent;border-radius:11px;color:#75877d;font-size:14px;font-weight:700}
.management-tab.selected{background:#fff;color:#386f55;box-shadow:0 1px 5px rgba(41,69,50,.09)}
.management-tab:focus-visible{outline:2px solid #43866a;outline-offset:2px}
.management-tab-content{display:grid;gap:16px;min-width:0}
.management-tabs:has(.management-tab:only-child){grid-template-columns:minmax(0,1fr)}
.management-approval-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;
  margin:12px 0;padding:4px;border-radius:11px;background:#edf3ed}
.management-approval-tab{min-width:0;min-height:44px;padding:9px 8px;border:0;border-radius:9px;
  background:transparent;color:#72867a;font-size:13px;font-weight:700}
.management-approval-tab.selected{background:#fff;color:#396f54;box-shadow:0 1px 5px #28443212}
.management-approval-tab:focus-visible{outline:2px solid #43866a;outline-offset:2px}
.management-approval-body{display:grid;gap:9px;min-width:0}
.management-family-approval-hub :deep(.approval-center),
.management-family-approval-hub :deep(.recurring-finance){border:0;box-shadow:none;
  background:transparent;padding:0;margin:0;min-width:0}
.management-app-actions{display:flex;align-items:center;gap:8px}
.management-app-actions>button{flex:1 1 0;min-width:0;min-height:44px;font-size:12px}
.management-family-invites{border-top:1px solid #edf0eb;margin-top:15px;padding-top:12px}
.management-family-invites h3{font-size:13px;margin:0 0 6px}
.management-invite-code{display:grid;gap:6px;margin-top:8px}
.management-invite-code small{font-size:11px;color:#789184}
.reminder-rules-trigger{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-top:14px;padding:11px 12px;background:#f7faf7;border:1px solid #e1eae2;
  border-radius:11px;font-size:13px;font-weight:600;color:#466c56;text-align:left}
.reminder-rules-trigger span:last-child{font-size:12px;color:#729480;font-weight:500}
.reminder-rules-trigger:focus-visible{outline:2px solid #43866a;outline-offset:2px}
</style>
