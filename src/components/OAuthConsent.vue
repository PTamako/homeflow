<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'

// Authorization is shown only after HomeFlow has authenticated the user.
// The business application's server must independently validate state, PKCE,
// the redirect URI, the HomeFlow userinfo audience and create its own cookie.
const options=new URLSearchParams(window.location.search)
const clientId=options.get('client_id')||''
const redirectUri=options.get('redirect_uri')||''
const codeChallenge=options.get('code_challenge')||''
const challengeMethod=options.get('code_challenge_method')||''
const state=options.get('state')||''
const nonce=options.get('nonce')||''
const clientNames:Record<string,string>={
 'kakebo':'家計簿',
 'it-study-platform':'知学',
 'jp-document-assistant':'日本生活文书助手'
}
const appLabel=computed(()=>clientNames[clientId]||'其他应用')
const nickname=ref('当前 HomeFlow 账号')
const role=ref('')
const busy=ref(false)
const error=ref('')
const ready=computed(()=>
 clientId.length>0&&redirectUri.length>0&&codeChallenge.length===43&&
 challengeMethod==='S256'&&state.length>=16&&nonce.length>=16)
onMounted(async()=>{
 try{
  const response=await fetch('/api/identity/me',{credentials:'same-origin',cache:'no-store'})
  if(!response.ok)return
  const value=await response.json() as {nickname?:string;role?:string}
  if(typeof value.nickname==='string'&&value.nickname)nickname.value=value.nickname
  if(value.role==='owner'||value.role==='member')role.value=value.role
 }catch{/* A failed display-only lookup is not authorization. */}
})
async function approve(){
 if(!ready.value||busy.value)return
 busy.value=true
 error.value=''
 try{
  const response=await fetch('/api/oauth/authorize',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({
    response_type:'code',client_id:clientId,redirect_uri:redirectUri,
    code_challenge:codeChallenge,code_challenge_method:challengeMethod,
    state,nonce,consent:true
   })
  })
  const data=await response.json() as {redirect_uri?:string;error?:string}
  if(!response.ok||typeof data.redirect_uri!=='string')
    throw Error(data.error==='oauth_disabled'?'统一登录尚未开放，请稍后再试。':'授权失败，请检查来源并重新打开。')
  // Never construct a callback URL client-side. Follow the exact server
  // allowlisted destination only after the user explicitly grants access.
  window.location.assign(data.redirect_uri)
 }catch(e){
  error=e instanceof Error?e.message:'授权失败，请重新尝试。'
  busy.value=false
 }
}
function cancel(){
 // An untrusted caller cannot choose where Cancel redirects.
 window.location.assign('/')
}
</script>

<template>
 <div class="oauth-screen">
  <section class="oauth-panel" role="dialog" aria-modal="true" aria-labelledby="oauth-title">
   <div class="oauth-symbol" aria-hidden="true">⌂</div>
   <p class="oauth-overline">HOMEFLOW · 统一账号</p>
   <h2 id="oauth-title">授权登录 {{ appLabel }}</h2>
   <p class="oauth-message">你正在使用 <strong>{{ nickname }}</strong><span v-if="role">（{{ role==='owner'?'家庭管理员':'家庭成员' }}）</span>登录另一个家庭应用。</p>
   <p class="oauth-message">该应用只会获取你的用户 ID、家庭、角色和昵称，不会获得 HomeFlow 密码。</p>
   <p v-if="!ready" class="oauth-error" role="alert">授权链接无效，请从应用的登录入口重新打开。</p>
   <p v-if="error" class="oauth-error" role="alert">{{ error }}</p>
   <div class="oauth-actions">
    <button type="button" class="oauth-cancel" @click="cancel">取消</button>
    <button type="button" class="oauth-approve" :disabled="busy||!ready" @click="approve">
      {{ busy?'正在授权…':'允许并继续' }}
    </button>
   </div>
   <p class="oauth-footnote">登录完成后由目标应用独立保存安全会话。</p>
  </section>
 </div>
</template>

<style scoped>
.oauth-screen{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;
 background:rgba(26,40,51,.52);backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);padding:18px}
.oauth-panel{box-sizing:border-box;width:min(100%,420px);max-height:90dvh;overflow:auto;
 padding:26px 24px 20px;text-align:center;border-radius:24px;
 background:rgba(255,255,255,.96);color:#23394b;border:1px solid rgba(255,255,255,.7);
 box-shadow:0 20px 65px rgba(16,31,48,.22)}
.oauth-symbol{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 12px;
 font-size:32px;color:#226d7c;background:#e7f3f1;border-radius:17px}
.oauth-overline{letter-spacing:.13em;font-size:10px;font-weight:700;color:#66838d;margin:0 0 7px}
h2{margin:0 0 16px;font-size:20px;line-height:1.4}
.oauth-message{font-size:14px;line-height:1.8;color:#4a626f;margin:10px 0}
.oauth-message strong{color:#164a5e}
.oauth-actions{display:flex;gap:10px;margin-top:20px}
.oauth-actions button{flex:1;min-height:44px;border-radius:13px;font-weight:700;font-size:14px}
.oauth-cancel{color:#365664;background:#f0f5f7;border:1px solid #dce6ea}
.oauth-approve{border:0;color:white;background:#28768b}
.oauth-approve:disabled{opacity:.45}
.oauth-error{color:#b03035;background:#fff1f1;padding:9px 12px;border-radius:9px;font-size:13px}
.oauth-footnote{font-size:11px;color:#778d96;line-height:1.5;margin:15px 0 0}
</style>
