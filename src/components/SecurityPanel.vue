<script setup lang="ts">
import {ref} from 'vue'
import {loginPassword,registerPassword,validLocalPassword} from '../auth-crypto'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
const props=defineProps<{loginName:string}>()
const expanded=ref(false),currentPassword=ref(''),newPassword=ref(''),confirmed=ref('')
const busy=ref(false),error=ref('')
const {toast,notify}=usePageToast()
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
  expanded.value=false
  notify('密码已更新，其他设备的登录会话已退出')
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <section class="security-panel">
  <button type="button" class="security-toggle" :aria-expanded="expanded" @click="expanded=!expanded">
    账号安全 · {{ expanded?'收起':'修改密码' }}
  </button>
  <form v-if="expanded" class="security-form" @submit.prevent="changePassword">
   <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" required minlength="12"/></label>
   <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"/></label>
   <label>确认新密码<input v-model="confirmed" type="password" autocomplete="new-password" required minlength="12" maxlength="128"/></label>
   <p v-if="error" role="alert">{{ error }}</p>
   <button type="submit" :disabled="busy">{{ busy?'正在修改…':'保存新密码' }}</button>
  </form>
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
</style>
