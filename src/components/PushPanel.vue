<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
const props=defineProps<{userId:string;members?:Array<{id:string;loginName:string}>}>()
const otherMembers=computed(()=>(props.members||[]).filter(m=>m.id!==props.userId))
const available=ref(false),configured=ref(false),enabled=ref(false),busy=ref(false),message=ref('')
const familyFormOpen=ref(false),recipientId=ref(''),familyMessage=ref('')
const familyBusy=ref(false),familyError=ref('')
const {toast,notify}=usePageToast()
let publicKey=''
function decodeKey(value:string){
  const str=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4))
  return Uint8Array.from(str,c=>c.charCodeAt(0))
}
async function discover(){
  try{
    const r=await fetch('/api/push/config',{credentials:'same-origin',cache:'no-store'})
    const data=await r.json()
    if(!r.ok||!data.configured||!data.publicKey){message.value='推送尚未配置。';return}
    publicKey=data.publicKey
    configured.value=true
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
      message.value='当前浏览器不支持接收推送。iPhone 请先添加 HomeFlow 到主屏幕。'
      return
    }
    available.value=true
    const registration=await navigator.serviceWorker.ready
    enabled.value=!!await registration.pushManager.getSubscription()
  }catch{message.value='暂时无法检测推送状态。'}
}
async function enable(){
  busy.value=true;message.value=''
  try{
    if(!publicKey)throw Error('尚未完成推送配置')
    const permission=await Notification.requestPermission()
    if(permission!=='granted')throw Error('未授权通知，可以在手机设置中开启。')
    const registration=await navigator.serviceWorker.ready
    const sub=await registration.pushManager.subscribe({userVisibleOnly:true,
      applicationServerKey:decodeKey(publicKey)})
    const data=sub.toJSON()
    const r=await fetch('/api/push/subscriptions',{method:'POST',credentials:'same-origin',
      headers:{'content-type':'application/json'},body:JSON.stringify(data)})
    if(!r.ok)throw Error('服务器尚未接受推送订阅，请重试')
    enabled.value=true
    notify('已开启每日提醒（日本时间上午 8 点）')
  }catch(e){message.value=(e as Error).message}
  finally{busy.value=false}
}
async function sendNow(){
  if(!enabled.value||busy.value)return
  busy.value=true;message.value=''
  try{
    const response=await fetch('/api/push/send-now',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'content-type':'application/json'},body:'{}'
    })
    const data=await response.json().catch(()=>({}))
    if(!response.ok)throw Error(data.error==='push_rate_limited'?'每分钟最多立即推送一次':
      data.error==='push_not_subscribed'?'当前账号尚未订阅推送':
      '推送未能送达，请检查设备授权')
    notify('已推送到当前账号的 '+data.sent+' 台设备')
  }catch(e){message.value=(e as Error).message}
  finally{busy.value=false}
}
async function sendFamily(){
 if(!recipientId.value||!familyMessage.value.trim()||familyBusy.value)return
 familyBusy.value=true;familyError.value=''
 try{
  const response=await fetch('/api/push/send-family',{method:'POST',
    credentials:'same-origin',cache:'no-store',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({recipientUserId:recipientId.value,message:familyMessage.value.trim()})})
  const data=await response.json().catch(()=>({}))
  if(!response.ok){
    const reasons:Record<string,string>={
      recipient_not_subscribed:'对方尚未开启 HomeFlow 推送',
      recipient_not_in_household:'接收人不属于当前家庭',
      push_rate_limited:'发送太频繁，请稍后再试',
      push_not_configured:'推送尚未配置'
    }
    throw Error(reasons[data.error]||'发送失败，请稍后重试')
  }
  familyMessage.value='';familyFormOpen.value=false
  notify('已发送给家人（'+data.sent+' 台设备）')
 }catch(e){familyError.value=(e as Error).message}
 finally{familyBusy.value=false}
}
async function disable(){
  busy.value=true;message.value=''
  try{
    const registration=await navigator.serviceWorker.ready
    const sub=await registration.pushManager.getSubscription()
    if(sub){
      const response=await fetch('/api/push/subscriptions',{method:'DELETE',credentials:'same-origin',
        headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})})
      if(!response.ok)throw Error('服务器取消订阅失败')
      await sub.unsubscribe()
    }
    enabled.value=false;notify('已关闭当前设备的推送')
  }catch(e){message.value=(e as Error).message}finally{busy.value=false}
}
onMounted(discover)
</script>
<template>
  <section class="push-setting">
    <button type="button" class="push-toggle" :aria-pressed="enabled" :disabled="busy||!available"
      @click="enabled?disable():enable()">{{ busy?'正在处理…':enabled?'关闭推送':'开启推送' }}</button>
    <button type="button" class="push-now" :disabled="busy||!available||!enabled"
      @click="sendNow">立即推送</button>
    <button v-if="otherMembers.length" type="button" class="push-now"
      :aria-expanded="familyFormOpen" @click="familyFormOpen=!familyFormOpen">
      {{ familyFormOpen?'收起家人消息':'发送给家人' }}
    </button>
    <form v-if="familyFormOpen" class="family-message-form" @submit.prevent="sendFamily">
      <label>接收人
        <select v-model="recipientId" required>
          <option value="" disabled>选择家人账号</option>
          <option v-for="member in otherMembers" :key="member.id" :value="member.id">{{ member.loginName }}</option>
        </select>
      </label>
      <label>消息
        <textarea v-model="familyMessage" maxlength="140" required rows="2" placeholder="输入要发送给家人的消息"/>
      </label>
      <button class="push-toggle" type="submit" :disabled="familyBusy||!configured||!recipientId||!familyMessage.trim()">
        {{ familyBusy?'发送中…':'发送消息' }}
      </button>
      <small v-if="familyError" role="alert">{{ familyError }}</small>
    </form>
    <small v-if="message" role="status">{{ message }}</small>
    <PageToast :toast="toast" />
  </section>
</template>
<style scoped>
.push-setting{display:grid;gap:6px;justify-items:start;margin-top:10px}
.push-toggle{background:#43866a;color:#fff;border:0;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:700;min-height:40px}
.push-toggle:disabled,.push-now:disabled{opacity:.55;cursor:not-allowed}
.push-now{border:1px solid #80a790;background:#fff;color:#397f5f;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:700;min-height:40px}
.push-toggle:focus-visible{outline:2px solid #43866a;outline-offset:3px}
.push-setting small{font-size:12px;line-height:1.55;color:#7b8c81;overflow-wrap:anywhere}
.family-message-form{display:grid;gap:8px;width:100%;max-width:420px;padding:10px 0}
.family-message-form label{display:grid;gap:5px;font-size:12px;color:#586b60}
.family-message-form select,.family-message-form textarea{
 box-sizing:border-box;width:100%;min-width:0;max-width:100%;
 font:inherit;font-size:16px;color:#263c31;background:#fff;border:1px solid #d9e4db;
 border-radius:10px;padding:10px
}
</style>
