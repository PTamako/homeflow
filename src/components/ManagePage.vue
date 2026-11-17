<script setup lang="ts">
import {ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import BackupPanel from './BackupPanel.vue'
import SecurityPanel from './SecurityPanel.vue'
import MemberConfirmationInbox from './MemberConfirmationInbox.vue'
import FamilyApprovalFeed from './FamilyApprovalFeed.vue'
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
 if(!active)section.value='personal'
})
watch(()=>props.isOwner,isOwner=>{
 if(!isOwner)section.value='personal'
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
   <nav v-if="isOwner" class="management-tabs" role="tablist" aria-label="管理分类">
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
     :aria-labelledby="isOwner?'management-personal-tab':undefined"
     :aria-label="isOwner?undefined:'个人管理'" class="management-tab-content">
     <section class="panel">
       <div class="management-section-heading"><AppIcon name="users" :size="20"/><h2>个人账号</h2></div>
       <p class="management-account">当前账号：<b>{{ loginName }}</b></p>
       <SecurityPanel v-if="active" :login-name="loginName"/>
     </section>
     <MemberConfirmationInbox v-if="active&&!isOwner" :active="active"
       :user-id="userId" :is-owner="isOwner" :members="members" :profiles="profiles"/>
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
     <FamilyApprovalFeed v-if="active&&isOwner" :active="active" :user-id="userId"
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
