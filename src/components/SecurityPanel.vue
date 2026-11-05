<script setup lang="ts">
import {ref} from 'vue'
import {loginPassword,registerPassword,validLocalPassword} from '../auth-crypto'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
const props=defineProps<{loginName:string}>()
const expanded=ref(false),currentPassword=ref(''),newPassword=ref(''),confirmed=ref('')
const busy=ref(false),error=ref('')
const backupCodes=ref<string[]>([]),codeBusy=ref(false)
const {toast,notify}=usePageToast()
async function issueRecoveryCodes(){
 error.value='';codeBusy.value=true;backupCodes.value=[]
 try{
  const old=await loginPassword(props.loginName,currentPassword.value)
  const response=await fetch('/api/auth/recovery-codes',{method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json'},body:JSON.stringify({currentPasswordProof:old.passwordProof})})
  const data=await response.json()
  if(!response.ok)throw Error(data.error==='invalid_credentials'?'当前密码不正确':data.error||'恢复码生成失败')
  if(!Array.isArray(data.codes)||data.codes.length!==5)throw Error('恢复码响应异常')
  backupCodes.value=data.codes
  notify('请将恢复码保存在安全的地方，关闭后不再显示')
 }catch(e){error.value=(e as Error).message}finally{codeBusy.value=false}
}
function toggleSecurity(){expanded.value=!expanded.value;if(!expanded.value)backupCodes.value=[]}
async function changePassword(){
 error.value=''
 if(!validLocalPassword(newPassword.value)||newPassword.value!==confirmed.value){
  error.value='新密码必须为12～128位，并与确认密码一致';return
 }
 if(currentPassword.value===newPassword.value){
  error.value='新密码不能与旧密码相同';return
 }
 busy.value=true
 try{
  const old=await loginPassword(props.loginName,currentPassword.value)
  const fresh=await registerPassword(newPassword.value)
  const response=await fetch('/api/auth/change-password',{
   method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
   body:JSON.stringify({currentPasswordProof:old.passwordProof,
    newPasswordProof:fresh.passwordProof,newPasswordSalt:fresh.passwordSalt,
    newPasswordRounds:fresh.passwordRounds})})
  const data=await response.json()
  if(!response.ok)throw Error(data.error==='invalid_credentials'?'旧密码不正确':data.error||'修改密码失败')
  currentPassword.value='';newPassword.value='';confirmed.value=''
  expanded.value=false;backupCodes.value=[]
  notify('密码已更新，其他设备的登录会话已退出')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <section class="security-panel">
  <button type="button" class="security-toggle" :aria-expanded="expanded" @click="toggleSecurity">
    账号安全 · {{ expanded?'收起':'修改密码' }}
  </button>
  <form v-if="expanded" class="security-form" @submit.prevent="changePassword">
   <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" required minlength="12"/></label>
   <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"/></label>
   <label>确认新密码<input v-model="confirmed" type="password" autocomplete="new-password" required minlength="12" maxlength="128"/></label>
   <p v-if="error" role="alert">{{ error }}</p>
   <button type="submit" :disabled="busy">{{ busy?'正在修改…':'保存新密码' }}</button>
  </form>
  <div v-if="expanded" class="recovery-section">
   <button type="button" :disabled="codeBusy||!currentPassword" @click="issueRecoveryCodes">
     {{ codeBusy?'生成中…':'生成／重新生成5个恢复码' }}
   </button>
   <small>需要填写上方当前密码；重新生成会使旧恢复码立即失效。</small>
   <div v-if="backupCodes.length" class="recovery-list">
     <p>仅此一次显示，请立即复制并离线保存；每个恢复码只能使用一次。</p>
     <code v-for="code in backupCodes" :key="code">{{ code }}</code>
   </div>
  </div>
  <PageToast :toast="toast"/>
 </section>
</template>
<style scoped>
.security-toggle{border:0;background:transparent;color:#3d795d;font-weight:650;font-size:12px;padding:7px 0;text-align:left}
.security-form{display:grid;gap:8px;margin-top:6px}
.security-form label{font-size:12px;display:grid;gap:4px}
.security-form input{width:100%;box-sizing:border-box;min-height:38px;border:1px solid #dbe5dc;border-radius:9px;padding:7px}
.security-form button{border:0;border-radius:9px;background:#43866a;color:#fff;padding:9px;font-weight:650}
.security-form p{font-size:12px;color:#a14739}
.recovery-section{display:grid;gap:7px;margin-top:9px}
.recovery-section button{border:0;border-radius:9px;padding:9px;background:#e7f3e9;color:#367452;font-weight:650}
.recovery-section small{font-size:11px;color:#819187}
.recovery-list{display:grid;gap:5px;padding:9px;border-radius:10px;background:#f4f7f4;overflow-wrap:anywhere}
.recovery-list p{font-size:11px;color:#a04f3b}
.recovery-list code{font-size:11px;word-break:break-all}
</style>
