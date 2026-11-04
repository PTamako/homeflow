<script setup lang="ts">
import {onMounted,ref} from 'vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
const available=ref(false),enabled=ref(false),busy=ref(false),message=ref('')
const {toast,notify}=usePageToast()
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
    notify('已开启每日提醒（日本时间上午 8 点）')
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
    enabled.value=false;notify('已关闭当前设备的推送')
  }catch(e){message.value=(e as Error).message}finally{busy.value=false}
}
onMounted(discover)
</script>
<template>
  <section class="push-setting">
    <button type="button" class="push-toggle" :aria-pressed="enabled" :disabled="busy||!available"
      @click="enabled?disable():enable()">{{ busy?'正在处理…':enabled?'关闭推送':'开启推送' }}</button>
    <small v-if="message" role="status">{{ message }}</small>
    <PageToast :toast="toast" />
  </section>
</template>
<style scoped>
.push-setting{display:grid;gap:6px;justify-items:start;margin-top:10px}
.push-toggle{background:#43866a;color:#fff;border:0;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:700;min-height:40px}
.push-toggle:disabled{opacity:.55;cursor:not-allowed}
.push-toggle:focus-visible{outline:2px solid #43866a;outline-offset:3px}
.push-setting small{font-size:12px;line-height:1.55;color:#7b8c81;overflow-wrap:anywhere}
</style>
