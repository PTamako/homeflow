<script setup lang="ts">
import {onMounted,ref} from 'vue'
import AppIcon from './AppIcon.vue'
const available=ref(false),enabled=ref(false),busy=ref(false),message=ref('')
let publicKey=''
function decodeKey(value:string){
  const str=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4))
  return Uint8Array.from(str,c=>c.charCodeAt(0))
}
async function discover(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
    message.value='当前浏览器不支持 Web Push。iPhone 请先添加 HomeFlow 到主屏幕。'
    return
  }
  try{
    const r=await fetch('/api/push/config',{credentials:'same-origin',cache:'no-store'})
    const data=await r.json()
    if(!r.ok||!data.configured||!data.publicKey){message.value='推送还未设置 VAPID 密钥。可以直接用手机生成，无需电脑。';return}
    publicKey=data.publicKey
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
    message.value='已开启每日提醒（默认日本时间上午 8 点）'
  }catch(e){message.value=(e as Error).message}
  finally{busy.value=false}
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
    enabled.value=false;message.value='已关闭当前设备的推送'
  }catch(e){message.value=(e as Error).message}finally{busy.value=false}
}
onMounted(discover)
</script>
<template>
  <section class="push-card">
    <div><b class="push-heading"><AppIcon name="bell" :size="20" /> 重要日子与每日提醒</b>
      <p>生日、纪念日、豆沙护理、到期待办。通知不会透露私人数据给其他家庭账号。</p></div>
    <button v-if="available" :disabled="busy" @click="enabled?disable():enable()">{{ enabled?'关闭本机推送':'开启锁屏通知' }}</button>
    <small v-if="message">{{ message }}</small>
    <a v-if="!available" class="setup-link" href="/vapid-setup.html">用 iPhone 配置推送密钥（无需电脑）</a>
  </section>
</template>
<style scoped>
.push-card{background:#fff;border:1px solid #eeeae4;border-radius:17px;padding:16px 20px;margin:16px 0;display:grid;gap:10px}
.push-card b{font-size:15px}.push-heading{display:flex;align-items:center;gap:9px}.push-card p,.push-card small{font-size:12px;line-height:1.7;color:#7b8c81;margin:6px 0}
.push-card button{background:#43866a;color:#fff;border:0;border-radius:10px;padding:10px 12px;font-size:13px;justify-self:start}
.push-card button:disabled{opacity:.6}.setup-link{color:#327f5d;font-size:13px;font-weight:700;text-decoration:underline;text-underline-offset:3px}
</style>
