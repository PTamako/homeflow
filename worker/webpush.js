import {json,readBody,sha256} from './security.js'
import {remindersRoute} from './reminders.js'

const encoder=new TextEncoder()
const bytes=(...parts)=> {
  const segments=parts.map(p=>typeof p==='string'?encoder.encode(p):new Uint8Array(p))
  const result=new Uint8Array(segments.reduce((sum,p)=>sum+p.length,0))
  let offset=0
  for(const s of segments){result.set(s,offset);offset+=s.length}
  return result
}
const encodeB64=a=>btoa(Array.from(new Uint8Array(a),x=>String.fromCharCode(x)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const decodeB64=s=> {
  if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)||s.length>1000)throw Error('invalid_base64url')
  const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4))
  return Uint8Array.from(b,x=>x.charCodeAt(0))
}
const endpointAllowed=uri=>{
  try{
    const u=new URL(uri)
    if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||u.href.length>2048)return false
    return u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||
      u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com')||
      u.hostname==='updates.push.services.mozilla.com'||u.hostname==='push.services.mozilla.com'
  }catch{return false}
}
const validKeys=k=>{
  if(!k||typeof k!=='object')return false
  try{return decodeB64(k.p256dh).length===65&&decodeB64(k.auth).length===16}catch{return false}
}
export const validSubscription=b=>b&&typeof b==='object'&&endpointAllowed(b.endpoint)&&validKeys(b.keys)
const vapidReady=env=>{
  if(typeof env.VAPID_PUBLIC_KEY!=='string'||typeof env.VAPID_PRIVATE_JWK!=='string')return false
  try{
    const pub=decodeB64(env.VAPID_PUBLIC_KEY)
    const jwk=JSON.parse(env.VAPID_PRIVATE_JWK)
    return pub.length===65&&jwk.kty==='EC'&&jwk.crv==='P-256'&&typeof jwk.d==='string'&&
      typeof jwk.x==='string'&&typeof jwk.y==='string'
  }catch{return false}
}
export async function pushRoute(request,env,path,session){
  const db=env.DB
  if(path==='/api/push/config'&&request.method==='GET'){
    return json({configured:vapidReady(env),publicKey:vapidReady(env)?env.VAPID_PUBLIC_KEY:null,
      help:'iPhone/iPad Safari: add HomeFlow to the Home Screen, then allow notifications.'})
  }
  if(path==='/api/push/subscriptions'&&request.method==='POST'){
    if(!vapidReady(env))return json({error:'push_not_configured'},503)
    const body=await readBody(request)
    if(!validSubscription(body))return json({error:'invalid_subscription'},400)
    const endpointHash=await sha256(body.endpoint)
    // A new browser subscription replaces only that endpoint; no cross-user endpoint takeover.
    const existing=await db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint_hash=?1')
      .bind(endpointHash).first()
    if(existing&&existing.user_id!==session.user_id)return json({error:'subscription_conflict'},409)
    await db.prepare(`INSERT INTO push_subscriptions(endpoint_hash,household_id,user_id,endpoint,p256dh,auth_secret)
      VALUES(?1,?2,?3,?4,?5,?6)
      ON CONFLICT(endpoint_hash) DO UPDATE SET p256dh=excluded.p256dh,
        auth_secret=excluded.auth_secret,updated_at=CURRENT_TIMESTAMP`)
      .bind(endpointHash,session.household_id,session.user_id,body.endpoint,body.keys.p256dh,body.keys.auth).run()
    return json({ok:true},201)
  }
  if(path==='/api/push/subscriptions'&&request.method==='DELETE'){
    const body=await readBody(request)
    if(!body||!endpointAllowed(body.endpoint))return json({error:'invalid_input'},400)
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=?1 AND user_id=?2 AND household_id=?3')
      .bind(await sha256(body.endpoint),session.user_id,session.household_id).run()
    return json({ok:true})
  }
  return json({error:'not_found'},404)
}
async function hkdf(input,salt,info,bits){
  const key=await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits'])
  return crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:bytes(info)},key,bits)
}
async function jwt(endpoint,env){
  const header=encodeB64(bytes(JSON.stringify({typ:'JWT',alg:'ES256'})))
  const audience=new URL(endpoint).origin
  const payload=encodeB64(bytes(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+12*3600,
    sub:'https://github.com/PTamako/homeflow'})))
  const toSign=header+'.'+payload
  const privateKey=await crypto.subtle.importKey('jwk',JSON.parse(env.VAPID_PRIVATE_JWK),
    {name:'ECDSA',namedCurve:'P-256'},false,['sign'])
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,bytes(toSign))
  return toSign+'.'+encodeB64(signature)
}
async function encrypt(data,subscription){
  const receiver=await crypto.subtle.importKey('raw',decodeB64(subscription.p256dh),
    {name:'ECDH',namedCurve:'P-256'},false,[])
  const local=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits'])
  const localPublic=new Uint8Array(await crypto.subtle.exportKey('raw',local.publicKey))
  const secret=await crypto.subtle.deriveBits({name:'ECDH',public:receiver},local.privateKey,256)
  const auth=decodeB64(subscription.auth_secret)
  const info=bytes('WebPush: info\0',decodeB64(subscription.p256dh),localPublic)
  const ikm=await hkdf(secret,auth,info,256)
  const salt=crypto.getRandomValues(new Uint8Array(16))
  const cek=await hkdf(ikm,salt,'Content-Encoding: aes128gcm\0',128)
  const nonce=await hkdf(ikm,salt,'Content-Encoding: nonce\0',96)
  const key=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt'])
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},
    key,bytes(encoder.encode(JSON.stringify(data)),new Uint8Array([2])))
  // aes128gcm: 16-byte salt, 4-byte record size, 1-byte server key length, server key, ciphertext.
  const header=new Uint8Array(16+4+1+65)
  header.set(salt,0)
  new DataView(header.buffer).setUint32(16,4096)
  header[20]=65
  header.set(localPublic,21)
  return bytes(header,encrypted)
}
async function deliver(sub,env,data){
  const body=await encrypt(data,sub)
  const jwtValue=await jwt(sub.endpoint,env)
  return fetch(sub.endpoint,{
    method:'POST',
    headers:{
      Authorization:'vapid t='+jwtValue+', k='+env.VAPID_PUBLIC_KEY,
      'Content-Encoding':'aes128gcm',
      'Content-Type':'application/octet-stream',
      TTL:'86400',
      Urgency:'normal',
    },
    body,
    redirect:'error',
  })
}
export async function runPushSchedule(env,now=Date.now()){
  if(!vapidReady(env))return {skipped:'push_not_configured'}
  const db=env.DB
  const day=new Date(now+9*3600000).toISOString().slice(0,10)
  const {results:subscriptions=[]}=await db.prepare(`SELECT endpoint_hash,endpoint,p256dh,auth_secret,user_id,household_id
    FROM push_subscriptions ORDER BY user_id LIMIT 20`).all()
  if(!subscriptions.length)return {checked:0,sent:0}
  let sent=0,failed=0,checked=0
  // Reuse a reminder read for every member; avoid duplicate D1 reads per device.
  const remindersCache=new Map()
  for(const sub of subscriptions){
    if(!endpointAllowed(sub.endpoint)||!validKeys({p256dh:sub.p256dh,auth:sub.auth_secret}))continue
    if(!remindersCache.has(sub.user_id)){
      const response=await remindersRoute(new Request('https://homeflow.invalid/api/reminders?date='+day),
        db,{user_id:sub.user_id,household_id:sub.household_id})
      remindersCache.set(sub.user_id,(await response.json()).items||[])
    }
    const events=remindersCache.get(sub.user_id).slice(0,20)
    for(const event of events){
      const key=[event.kind,event.id,event.dueOn,event.daysBefore??0].join(':')
      const claim=await db.prepare(`INSERT OR IGNORE INTO notification_deliveries
        (endpoint_hash,notification_key,sent_on,status) VALUES(?1,?2,?3,'claimed')`)
        .bind(sub.endpoint_hash,key,day).run()
      if(!claim.meta?.changes)continue
      checked++
      let status=0,result='failed'
      try{
        const res=await deliver(sub,env,{title:event.title.slice(0,80),
          body:event.kind==='anniversary'?'家庭重要日子提醒':event.kind==='routine'?'今天的定期事项':'待办事项到期',
          url:'/',tag:key})
        status=res.status
        result=res.ok?'sent':res.status===404||res.status===410?'gone':'failed'
      }catch{result='failed'}
      if(result==='sent')sent++;else failed++
      await db.prepare(`UPDATE notification_deliveries SET status=?1,status_code=?2,updated_at=CURRENT_TIMESTAMP
        WHERE endpoint_hash=?3 AND notification_key=?4 AND sent_on=?5`)
        .bind(result,status,sub.endpoint_hash,key,day).run()
      if(result==='gone'){
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=?1').bind(sub.endpoint_hash).run()
        break
      }
    }
  }
  return {checked,sent,failed}
}
