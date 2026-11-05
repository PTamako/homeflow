<script setup lang="ts">
import {ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import BackupPanel from './BackupPanel.vue'
import SecurityPanel from './SecurityPanel.vue'
import TrashPanel from './TrashPanel.vue'
import PushPanel from './PushPanel.vue'
import ImportantReminders from './ImportantReminders.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'

const props=defineProps<{active:boolean;userId:string;loginName:string;isOwner:boolean;todayDate:string;todayEntryKeys:string[]}>()
const emit=defineEmits<{logout:[];presenceChange:[has:boolean]}>()
const invitation=ref(''),inviting=ref(false),inviteError=ref('')
const reminders=ref<{refreshIfStale:()=>void}|null>(null)
const {toast,notify}=usePageToast()
// An invitation is a bearer credential. Clear its visible value when leaving
// Management; fetching or creating a new one always requires an explicit tap.
watch(()=>props.active,active=>{
 if(!active){invitation.value='';inviteError.value=''}
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
function refreshIfStale(){reminders.value?.refreshIfStale()}
defineExpose({refreshIfStale})
</script>

<template>
 <div class="management-page" aria-label="HomeFlow 管理">
   <section class="panel">
     <div class="management-section-heading"><AppIcon name="users" :size="20"/><h2>账号与家庭权限</h2></div>
     <p class="management-account">当前账号：<b>{{ loginName }}</b></p>
     <SecurityPanel v-if="active" :login-name="loginName"/>
     <div v-if="isOwner" class="management-family-invites">
       <h3>邀请家庭成员</h3>
       <p class="hint">邀请码 7 天内有效，仅供家人使用；每个家庭最多两位登录成员。</p>
       <button type="button" class="outline" :disabled="inviting" @click="generateInvite">
         {{ inviting?'生成中…':'生成邀请码' }}
       </button>
       <p v-if="inviteError" role="alert" class="error">{{ inviteError }}</p>
       <div v-if="invitation" class="management-invite-code">
         <code>{{ invitation }}</code><small>请私下发送；不需要公开或放到时光轴。</small>
       </div>
     </div>
   </section>
   <section class="panel">
     <div class="management-section-heading"><AppIcon name="bell" :size="20"/><h2>通知与提醒设置</h2></div>
     <PushPanel v-if="active"/>
     <!-- Mount only once to preserve the Today red dot without extra requests. -->
     <ImportantReminders ref="reminders" :today-date="todayDate" :today-entry-keys="todayEntryKeys"
       compact @presence-change="emit('presenceChange',$event)"/>
   </section>
   <section class="panel">
     <div class="management-section-heading"><AppIcon name="archive" :size="20"/><h2>数据与回收箱</h2></div>
     <TrashPanel v-if="active"/>
     <p class="hint">计划、任务和回忆删除后可以恢复，原有历史及消费关联保留。</p>
   </section>
   <BackupPanel v-if="active" :user-id="userId"/>
   <section class="panel">
     <button type="button" class="management-logout" @click="emit('logout')">退出登录</button>
   </section>
   <PageToast :toast="toast"/>
 </div>
</template>
<style scoped>
.management-family-invites{border-top:1px solid #edf0eb;margin-top:15px;padding-top:12px}
.management-family-invites h3{font-size:13px;margin:0 0 6px}
.management-invite-code{display:grid;gap:6px;margin-top:8px}
.management-invite-code small{font-size:11px;color:#789184}
</style>
