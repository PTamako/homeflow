import {json,readBody,sha256} from './security.js'
import {remindersRoute,reminderDeliveryKey} from './reminders.js'
import {jstNotificationDay,saveNotification,findScheduledNotification} from './notifications.js'

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
  if(path==='/api/push/send-now'||path==='/api/push/send-task'||path==='/api/push/send-family'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    if(path==='/api/push/send-now'){
      if(!vapidReady(env))return json({error:'push_not_configured'},503)
      return sendNow(env,session)
    }
    const body=await readBody(request)
    if(path==='/api/push/send-task')return sendTaskPush(env,session,body)
    return sendFamilyPush(env,session,body)
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
export async function encrypt(data,subscription){
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
export const quietAtHour=(quiet,hour)=>{
  const start=quiet?.start,end=quiet?.end
  if(!Number.isInteger(start)||!Number.isInteger(end)||start===end)return false
  return start<end?hour>=start&&hour<end:hour>=start||hour<end
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
      Urgency:data.priority==='important'?'high':'normal',
    },
    body,
    redirect:'manual',
  })
}
// Only the current creator may push a household-visible task to its assigned handler.
// The household membership join prevents delivery to removed or unrelated accounts.
const UUID=/^[a-f0-9-]{36}$/i
async function sendTaskPush(env,session,body){
  if(!['task','routine','shopping'].includes(body?.kind)||!UUID.test(body?.id||''))return json({error:'invalid_input'},400)
  const note=body?.message===undefined?'':typeof body.message==='string'?
    body.message.trim().replace(/\s+/g,' '):null
  if(note===null||note.length>120)return json({error:'invalid_input'},400)
  const routine=body.kind==='routine',shopping=body.kind==='shopping'
  const table=routine?'routines':shopping?'shopping_items':'tasks'
  const creator=routine||shopping?'t.created_by':'t.creator_user_id'
  const assignee=routine||shopping?'t.assigned_to':'t.assignee_user_id'
  const due=routine?'t.next_due_on':'t.due_on'
  const status=routine?'t.enabled=1':'t.completed_at IS NULL'
  // Trusted table/column identifiers are selected from the two constants above.
  let item
  if(routine&&body.periodOn){
    if(typeof body.periodOn!=='string'||!/^\\d{4}-\\d{2}-\\d{2}$/.test(body.periodOn))
      return json({error:'invalid_input'},400)
    item=await env.DB.prepare(`SELECT t.id,t.title,a.occurrence_on AS dueOn,
       a.assignee_user_id AS recipientId FROM routine_occurrence_assignments a
       JOIN routines t ON t.id=a.routine_id AND t.household_id=a.household_id
       JOIN household_members m ON m.user_id=a.assignee_user_id
         AND m.household_id=a.household_id
       LEFT JOIN routine_marks rm ON rm.routine_id=a.routine_id
         AND rm.occurrence_on=a.occurrence_on
       WHERE a.routine_id=?1 AND a.household_id=?2 AND t.created_by=?3
         AND a.occurrence_on=?4 AND t.visibility='household' AND t.deleted_at IS NULL
         AND t.enabled=1 AND rm.completed_at IS NULL AND rm.skipped_at IS NULL LIMIT 1`)
       .bind(body.id,session.household_id,session.user_id,body.periodOn).first()
  }else{
    const sql=`SELECT t.id,t.title,${due} AS dueOn,${assignee} AS recipientId
      FROM ${table} t JOIN household_members m ON m.user_id=${assignee} AND m.household_id=t.household_id
      WHERE t.id=?1 AND t.household_id=?2 AND ${creator}=?3
      AND t.visibility='household' AND t.deleted_at IS NULL AND ${status} LIMIT 1`
    item=await env.DB.prepare(sql).bind(body.id,session.household_id,session.user_id).first()
  }
  if(!item)return json({error:'task_not_shareable'},404)
  if(item.recipientId===session.user_id)return json({error:'recipient_is_self'},409)
  const notificationId=crypto.randomUUID()
  const url='/?taskType='+body.kind+'&taskId='+encodeURIComponent(item.id)+
    (routine&&body.periodOn?'&taskPeriod='+encodeURIComponent(body.periodOn):'')+'&notificationId='+notificationId
  const content=(item.dueOn?'截止 '+item.dueOn+' · ':'')+(note||'请查看并处理这项任务')
  return deliverToHouseholdUser(env,session.household_id,item.recipientId,{
    title:String(item.title).slice(0,80),body:content,url,tag:'homeflow-task-'+body.kind+'-'+item.id+'-'+notificationId,
    priority:'important',recordInInbox:true
  },'task-'+body.kind+'-'+item.id+':'+notificationId,Date.now(),{
    id:notificationId,senderId:session.user_id,kind:body.kind,sourceId:item.id,
    title:String(item.title),message:content
  })
}

// Family messages and task notifications share the same verified recipient scope.
async function sendFamilyPush(env,session,body){
  if(typeof body?.recipientUserId!=='string'||!UUID.test(body.recipientUserId)||
      typeof body.message!=='string'||body.message.trim().length<1||
      body.message.trim().length>140)return json({error:'invalid_input'},400)
  if(body.recipientUserId===session.user_id)return json({error:'recipient_is_self'},409)
  const member=await env.DB.prepare(`SELECT user_id FROM household_members
    WHERE household_id=?1 AND user_id=?2 LIMIT 1`)
    .bind(session.household_id,body.recipientUserId).first()
  if(!member)return json({error:'recipient_not_in_household'},404)
  const notificationId=crypto.randomUUID()
  return deliverToHouseholdUser(env,session.household_id,member.user_id,{
    title:'HomeFlow · 家人消息',body:body.message.trim(),
    url:'/?notificationId='+notificationId,tag:'homeflow-family-'+notificationId,
    priority:'normal',recordInInbox:true
  },'family-'+session.user_id+':'+notificationId,Date.now(),{
    id:notificationId,senderId:session.user_id,kind:'family',title:'家人消息',
    message:body.message.trim()
  })
}

async function deliverToHouseholdUser(env,householdId,userId,payload,keyPrefix,now=Date.now(),meta=null){
  const db=env.DB
  const {results:subscriptions=[]}=await db.prepare(`SELECT endpoint_hash,endpoint,p256dh,auth_secret
    FROM push_subscriptions WHERE household_id=?1 AND user_id=?2 LIMIT 10`)
    .bind(householdId,userId).all()
  // The household inbox is the source of truth; Push is only an optional delivery channel.
  // Missing subscriptions must not silently drop a message.
  if(!subscriptions.length){
    if(!meta)return json({error:'recipient_not_subscribed'},409)
    await saveNotification(db,{...meta,householdId,recipientId:userId,
      localDay:jstNotificationDay(now),sentDevices:0,failedDevices:0})
    return json({ok:true,inAppOnly:true,sent:0,failed:0,already:0,recorded:true})
  }
  const jst=new Date(now+9*3600000).toISOString()
  const day=jst.slice(0,10),minute=jst.slice(11,16)
  // Ensure background iOS Push can read the new unread count right away.
  if(meta){
    try{await saveNotification(db,{...meta,householdId,recipientId:userId,
      localDay:day,sentDevices:0,failedDevices:0})}
    catch{return json({error:'notification_inbox_unavailable'},503)}
  }
  let sent=0,failed=0,already=0
  for(const sub of subscriptions){
    if(!endpointAllowed(sub.endpoint)||!validKeys({p256dh:sub.p256dh,auth:sub.auth_secret}))continue
    const key=meta?.dedupeKey?.startsWith('lottery:')?keyPrefix:keyPrefix+':'+minute
    const claimed=await db.prepare(`INSERT OR IGNORE INTO notification_deliveries
      (endpoint_hash,notification_key,sent_on,status,attempts)
      VALUES(?1,?2,?3,'claimed',1)`).bind(sub.endpoint_hash,key,day).run()
    if(!claimed.meta?.changes){already++;continue}
    let status=0,result='failed'
    try{
      const response=await deliver(sub,env,payload)
      status=response.status
      result=response.ok?'sent':status===404||status===410?'gone':'failed'
    }catch{}
    if(result==='sent')sent++;else failed++
    await db.prepare(`UPDATE notification_deliveries SET status=?1,status_code=?2,
      updated_at=CURRENT_TIMESTAMP WHERE endpoint_hash=?3 AND notification_key=?4 AND sent_on=?5`)
      .bind(result,status,sub.endpoint_hash,key,day).run()
    if(result==='gone')await db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=?1 AND user_id=?2')
      .bind(sub.endpoint_hash,userId).run()
  }
  if(!sent&&!failed&&!meta)return json({error:'push_rate_limited',already},429)
  // Reconcile one logical inbox record after delivery attempts.
  let recorded=true
  if(meta){
    try{await saveNotification(db,{...meta,householdId,recipientId:userId,
      localDay:day,sentDevices:sent,failedDevices:failed})}
    catch{recorded=false}
  }
  return json({ok:recorded&&!!meta?true:sent>0,inAppOnly:sent===0,sent,failed,already,recorded},
    (sent>0||(recorded&&!!meta))?200:502)
}

// Explicit manual push only reaches the authenticated user's subscribed devices.
// Claim once per device per JST minute to avoid duplicate sends and D1 bursts.
async function sendNow(env,session,now=Date.now()){
  const db=env.DB
  const {results:subscriptions=[]}=await db.prepare(`SELECT endpoint_hash,endpoint,p256dh,auth_secret
    FROM push_subscriptions WHERE household_id=?1 AND user_id=?2 LIMIT 10`)
    .bind(session.household_id,session.user_id).all()
  if(!subscriptions.length)return json({error:'push_not_subscribed'},409)
  const jst=new Date(now+9*3600000).toISOString()
  const day=jst.slice(0,10),slot=jst.slice(11,16)
  const r=await remindersRoute(new Request('https://homeflow.invalid/api/reminders?date='+day),db,session)
  if(!r.ok)return json({error:'reminders_unavailable'},503)
  const events=(await r.json()).items||[]
  const summary=events.length?events.slice(0,3).map(x=>x.title).join('、').slice(0,135):
    '当前没有到期提醒，推送通道正常'
  let sent=0,failed=0
  for(const sub of subscriptions){
    if(!endpointAllowed(sub.endpoint)||!validKeys({p256dh:sub.p256dh,auth:sub.auth_secret}))continue
    const key='manual-'+slot
    const claim=await db.prepare(`INSERT OR IGNORE INTO notification_deliveries
      (endpoint_hash,notification_key,sent_on,status,attempts)
      VALUES(?1,?2,?3,'claimed',1)`).bind(sub.endpoint_hash,key,day).run()
    if(!claim.meta?.changes)continue
    let status=0,result='failed'
    try{
      const response=await deliver(sub,env,{title:'HomeFlow · 立即提醒',
        body:summary,priority:'normal',url:'/',tag:'homeflow-manual-'+slot})
      status=response.status
      result=response.ok?'sent':status===404||status===410?'gone':'failed'
    }catch{}
    if(result==='sent')sent++;else failed++
    await db.prepare(`UPDATE notification_deliveries SET status=?1,status_code=?2,
      updated_at=CURRENT_TIMESTAMP WHERE endpoint_hash=?3 AND notification_key=?4 AND sent_on=?5`)
      .bind(result,status,sub.endpoint_hash,key,day).run()
    if(result==='gone')await db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=?1 AND user_id=?2')
      .bind(sub.endpoint_hash,session.user_id).run()
  }
  if(!sent&&!failed)return json({error:'push_rate_limited'},429)
  return json({ok:sent>0,sent,failed,reminderCount:events.length},sent>0?200:502)
}
// A scheduled notice must keep the same deep-link ID across Cron retries.
export async function scheduledNotificationId(recipientId,day,logicalKey){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(recipientId+'|'+day+'|'+logicalKey)))
  const b=digest.slice(0,16)
  b[6]=(b[6]&15)|80
  b[8]=(b[8]&63)|128
  const hex=[...b].map(x=>x.toString(16).padStart(2,'0')).join('')
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)
}
export async function runPushSchedule(env,now=Date.now()){
  const pushConfigured=vapidReady(env)
  const db=env.DB
  const jst=new Date(now+9*3600000)
  const day=jst.toISOString().slice(0,10),hour=jst.getUTCHours()
  const {results:subscriptions=[]}=pushConfigured
    ?await db.prepare(`SELECT endpoint_hash,endpoint,p256dh,auth_secret,user_id,household_id
      FROM push_subscriptions ORDER BY user_id LIMIT 20`).all():{results:[]}
  let sent=0,failed=0,checked=0,inbox=0
  // Every authenticated member receives a daily in-app notice, regardless of Push permissions.
  // Reuse each member's reminder batch for subscribed devices.
  const remindersCache=new Map()
  const notificationIds=new Map(),scheduledNotices=new Map(),deliveryTotals=new Map()
  const changedHouseholds=new Set()
  const {results:members=[]}=await db.prepare(`SELECT m.user_id,m.household_id
    FROM household_members m JOIN users u ON u.id=m.user_id
    WHERE u.disabled_at IS NULL ORDER BY m.household_id,m.user_id LIMIT 20`).all()
  for(const member of members){
    const response=await remindersRoute(new Request('https://homeflow.invalid/api/reminders?date='+day+'&goals=1'),
      db,{user_id:member.user_id,household_id:member.household_id})
    if(!response.ok)continue
    const data=await response.json()
    remindersCache.set(member.user_id,data)
    for(const event of (data.items||[]).slice(0,100)){
      const key=reminderDeliveryKey(event)
      const logicalKey=member.user_id+':'+key
      const notificationId=await scheduledNotificationId(member.user_id,day,logicalKey)
      notificationIds.set(logicalKey,notificationId)
      const message=event.message||(event.kind==='anniversary'?'家庭重要日子提醒':
        event.daysBefore?'提前 '+event.daysBefore+' 天提醒':
        event.kind==='routine'?'今天的定期事项':'待办事项到期')
      scheduledNotices.set(logicalKey,{
        id:notificationId,householdId:member.household_id,recipientId:member.user_id,
        kind:['task','routine','shopping'].includes(event.kind)?event.kind:'system',
        sourceId:event.id,title:event.title,message,localDay:day,dedupeKey:'scheduled:'+key
      })
    }
  }
  // Write each scheduled notice before sending to devices, not afterwards.
  for(const notice of scheduledNotices.values()){
    await saveNotification(db,{...notice,sentDevices:0,failedDevices:0})
    changedHouseholds.add(notice.householdId)
    inbox++
  }
  if(!subscriptions.length)return {checked:0,sent:0,failed:0,inbox,changedHouseholds:[...changedHouseholds]}
  for(const sub of subscriptions){
    if(!endpointAllowed(sub.endpoint)||!validKeys({p256dh:sub.p256dh,auth:sub.auth_secret}))continue
    if(!remindersCache.has(sub.user_id))continue
    const data=remindersCache.get(sub.user_id)
    // No push during user quiet hours. In-app reminders remain visible.
    // The default is disabled so the requested 06:00 JST push is delivered.
    if(quietAtHour(data.quietHours,hour))continue
    const events=(data.items||[]).slice(0,20)
    for(const event of events){
      const key=reminderDeliveryKey(event)
      const logicalKey=sub.user_id+':'+key
      if(!notificationIds.has(logicalKey))continue
      const notificationId=notificationIds.get(logicalKey)
      // Single atomic claim: sent/gone deliveries never replay, while stale
      // failed/claimed attempts may be reclaimed without extra SELECTs.
      const claim=await db.prepare(`INSERT INTO notification_deliveries
        (endpoint_hash,notification_key,sent_on,status,attempts)
        VALUES(?1,?2,?3,'claimed',1)
        ON CONFLICT(endpoint_hash,notification_key,sent_on) DO UPDATE SET
          status='claimed',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
        WHERE notification_deliveries.status IN ('failed','claimed')
          AND notification_deliveries.attempts < 3
          AND notification_deliveries.updated_at <= datetime('now','-15 minutes')`)
        .bind(sub.endpoint_hash,key,day).run()
      if(!claim.meta?.changes)continue
      checked++
      let status=0,result='failed',extraAttempts=0
      for(let attempt=0;attempt<2;attempt++){
        try{
          const res=await deliver(sub,env,{title:event.title.slice(0,80),
            priority:event.priority||'normal',
            body:event.message||(event.kind==='anniversary'?'家庭重要日子提醒':
              event.daysBefore?'提前 '+event.daysBefore+' 天提醒':
              event.kind==='routine'?'今天的定期事项':'待办事项到期'),
            url:['task','routine','shopping'].includes(event.kind)
              ?'/?taskType='+event.kind+'&taskId='+encodeURIComponent(event.id)+'&notificationId='+notificationId
              :'/?notificationId='+notificationId,
            tag:key,recordInInbox:true})
          status=res.status
          result=res.ok?'sent':res.status===404||res.status===410?'gone':'failed'
        }catch{result='failed'}
        const transient=status===0||status===408||status===429||status>=500
        if(result!=='failed'||!transient||attempt===1)break
        extraAttempts++
        await new Promise(resolve=>setTimeout(resolve,500))
      }
      if(result==='sent')sent++;else failed++
      const totals=deliveryTotals.get(logicalKey)||{sent:0,failed:0}
      if(result==='sent')totals.sent++
      else totals.failed++
      deliveryTotals.set(logicalKey,totals)
      await db.prepare(`UPDATE notification_deliveries
        SET status=?1,status_code=?2,attempts=MIN(3,attempts+?6),
          updated_at=CURRENT_TIMESTAMP
        WHERE endpoint_hash=?3 AND notification_key=?4 AND sent_on=?5`)
        .bind(result,status,sub.endpoint_hash,key,day,extraAttempts).run()
      if(result==='gone'){
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=?1').bind(sub.endpoint_hash).run()
        break
      }
    }
  }
  // Only notices with a Push attempt need a second status update.
  for(const [logicalKey,totals] of deliveryTotals){
    if(totals.sent||totals.failed)
      await saveNotification(db,{...scheduledNotices.get(logicalKey),
        sentDevices:totals.sent,failedDevices:totals.failed})
  }
  return {checked,sent,failed,inbox,changedHouseholds:[...changedHouseholds]}
}

/**
 * Completion feedback: unassigned shared tasks reach all OTHER members;
 * assigned shared tasks reach the creator/dispatcher. No self-notifications,
 * or disclosure of private tasks.
 */
export function completionRecipientIds(memberIds,event){
  if(event.visibility!=='household')return []
  const target=event.assigneeId?event.creatorId:null
  return [...new Set(memberIds)].filter(id=>typeof id==='string'&&
    id!==event.actorId&&(!target||id===target))
}

export async function sendCompletionFeedback(env,session,event){
  if(!session?.household_id||!session?.user_id||!['task','routine','shopping'].includes(event?.kind)||
    !UUID.test(event?.id||'')||!UUID.test(event?.creatorId||'')||
    typeof event?.title!=='string'||typeof event?.completedAt!=='string')
    return {skipped:'invalid_completion'}
  if(event.visibility!=='household')return {skipped:'private_completion'}
  const db=env.DB
  // One household-scoped roster read with the actor's linked profile name.
  const {results:members=[]}=await db.prepare(`SELECT m.user_id AS userId,
      COALESCE((SELECT fp.display_name FROM family_profiles fp
        WHERE fp.household_id=?1 AND fp.member_user_id=?2
          AND fp.type='person' AND fp.archived_at IS NULL LIMIT 1),'家庭成员') AS actorName
      FROM household_members m JOIN users u ON u.id=m.user_id
      WHERE m.household_id=?1 AND u.disabled_at IS NULL LIMIT 10`)
    .bind(session.household_id,session.user_id).all()
  const recipients=completionRecipientIds(members.map(m=>m.userId),{
    ...event,actorId:session.user_id})
  const actorName=String(members[0]?.actorName||'家庭成员').slice(0,60)
  const title=(String(event.title).slice(0,65)+' · 已完成').slice(0,90)
  const message='已完成 · '+actorName+
    (event.kind==='routine'&&event.periodOn?' · '+event.periodOn:'')
  const localDay=jstNotificationDay()
  const completionKey='complete:'+event.kind+':'+event.id+':'+event.completedAt
  const reminderScope=recipientId=>({
    householdId:session.household_id,recipientId,kind:event.kind,
    sourceId:event.id,periodOn:event.periodOn,localDay
  })
  // The person who completed the task may have received the 06:00 reminder,
  // too. Update it silently; completion Push remains addressed to OTHER members.
  try{
    const ownReminder=await findScheduledNotification(db,reminderScope(session.user_id))
    if(ownReminder)await saveNotification(db,{
      id:crypto.randomUUID(),householdId:session.household_id,
      recipientId:session.user_id,kind:event.kind,sourceId:event.id,
      senderId:null,title,message,localDay,dedupeKey:ownReminder.dedupeKey,
      mergeCompletion:true,completionKey,unreadOnCompletion:false,
      sentDevices:0,failedDevices:0
    })
  }catch{ /* Inbox updates never block a committed completion. */ }
  let sent=0,failed=0
  for(const recipientId of recipients){
    // A second OS Push is still sent for completion; only the in-app row is
    // reused. Keep the original reminder ID so either push opens that row.
    const receiptId=crypto.randomUUID()
    let scheduled=null
    try{scheduled=await findScheduledNotification(db,reminderScope(recipientId))}catch{}
    const notificationId=scheduled?.id||receiptId
    const params=new URLSearchParams({taskType:event.kind,taskId:event.id,
      taskDone:'1',notificationId})
    if(event.kind==='routine'&&/^\d{4}-\d{2}-\d{2}$/.test(event.periodOn||''))
      params.set('taskPeriod',event.periodOn)
    try{
      const reply=await deliverToHouseholdUser(env,session.household_id,recipientId,{
        title,body:message,url:'/?'+params.toString(),
        // Fresh completion notifications must not replace yesterday's banner.
        tag:'homeflow-done-'+event.kind+'-'+event.id+'-'+event.completedAt.replace(/[^0-9]/g,''),
        // Apple Web Push uses the high Urgency hint to attempt immediate delivery.
        priority:'important',recordInInbox:true
      },'complete:'+event.kind+':'+event.id+':'+event.completedAt,Date.now(),{
        id:receiptId,senderId:session.user_id,kind:event.kind,
        sourceId:event.id,title,message,
        dedupeKey:scheduled?.dedupeKey||completionKey,
        mergeCompletion:!!scheduled,completionKey,unreadOnCompletion:true
      })
      const data=await reply.json()
      sent+=Number(data?.sent||0)
      failed+=Number(data?.failed||0)
    }catch{failed++}
  }
  return {recipients:recipients.length,sent,failed}
}

/**
 * Each lottery draw is a separate TODAY inbox message for every household
 * member, including the player. A stable message ID and delivery key prevent
 * replays from clearing read status or sending duplicate iOS notifications.
 */
export async function sendLotteryDrawNotification(env,session,draw){
  if(!draw?.id||!draw?.userId||draw.householdId!==session.household_id||
    draw.userId!==session.user_id)return {skipped:'invalid_draw'}
  const db=env.DB
  const actor=await db.prepare(`SELECT COALESCE(
    (SELECT p.display_name FROM family_profiles p
     WHERE p.household_id=?1 AND p.member_user_id=?2 AND p.type='person'
       AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 1),
    u.login_name) AS name FROM users u WHERE u.id=?2`)
    .bind(session.household_id,draw.userId).first()
  const name=String(actor?.name||'家庭成员').slice(0,30)
  const label=draw.kind==='empty'?'空手而归':
    draw.kind==='double'?('当前积分翻倍，获得 '+draw.points+' 积分'):
    ('获得 '+draw.points+' 积分')
  const title='家庭抽奖 · '+name
  const message=name+' 抽奖：'+label+'（消耗 5 积分）'
  const {results:members=[]}=await db.prepare(`SELECT m.user_id AS id
    FROM household_members m JOIN users u ON u.id=m.user_id
    WHERE m.household_id=?1 AND u.disabled_at IS NULL LIMIT 20`)
    .bind(session.household_id).all()
  let sent=0,failed=0
  for(const member of members){
    try{
      const digest=await sha256(draw.id+'|'+member.id)
      const id=[digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),
        digest.slice(16,20),digest.slice(20,32)].join('-')
      const result=await deliverToHouseholdUser(env,session.household_id,member.id,{
        title,body:message,url:'/?notificationId='+id,
        tag:'homeflow-lottery-'+draw.id,priority:'important',recordInInbox:true
      },'lottery:'+draw.id,Date.now(),{
        id,senderId:draw.userId,kind:'system',sourceId:draw.id,
        title,message,dedupeKey:'lottery:'+draw.id
      })
      const payload=await result.json()
      sent+=Number(payload.sent||0)
      failed+=Number(payload.failed||0)
    }catch{failed++}
  }
  return {members:members.length,sent,failed}
}
