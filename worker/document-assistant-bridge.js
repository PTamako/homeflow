// Explicitly enabled, signed server-to-server import for the document assistant.
// No browser sessions/cookies, no user-supplied household_id, no public fallback.
import { tasksRoute } from './tasks.js'
import { bumpHouseholdRevision, bumpMemberRevision } from './sync.js'

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})
const enc=new TextEncoder()
const HEX=/^[a-f0-9]{64}$/i
const USER=/^[a-zA-Z0-9_-]{8,80}$/
const allowed=(s,id)=>String(s||'').split(',').some(x=>x.trim()===id)
const safeDate=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
async function verify(secret,input,sig){
  if(!HEX.test(sig||''))return false
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(input)))
  const actual=Uint8Array.from(sig.match(/.{2}/g),v=>parseInt(v,16))
  let mismatch=0;for(let i=0;i<32;i++)mismatch|=expected[i]^actual[i]
  return mismatch===0
}
async function stableUuid(key){
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(key)))].slice(0,16)
  digest[6]=(digest[6]&15)|0x40;digest[8]=(digest[8]&63)|0x80
  const x=digest.map(v=>v.toString(16).padStart(2,'0')).join('')
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`
}
export async function documentAssistantBridge(request,env){
  if(env.JPDA_BRIDGE_ENABLED!=='true')return json({ok:false,error:'bridge_disabled'},404)
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
  const secret=env.JPDA_BRIDGE_SECRET
  if(typeof secret!=='string'||secret.length<32)return json({ok:false,error:'bridge_not_configured'},503)
  const timestamp=request.headers.get('X-DA-Timestamp')||''
  if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000)
    return json({ok:false,error:'expired_signature'},401)
  const raw=await request.text()
  if(raw.length>8000)return json({ok:false,error:'payload_too_large'},413)
  if(!await verify(secret,`${timestamp}\n${raw}`,request.headers.get('X-DA-Signature')))
    return json({ok:false,error:'invalid_signature'},401)
  let msg;try{msg=JSON.parse(raw)}catch{return json({ok:false,error:'invalid_json'},400)}
  if(msg?.source!=='jp-document-assistant'||msg?.payload?.operation!=='task'||
    typeof msg?.idempotency_key!=='string'||!/^jda:homeflow:[a-f0-9]{16,64}$/i.test(msg.idempotency_key)||
    request.headers.get('Idempotency-Key')!==msg.idempotency_key)
    return json({ok:false,error:'invalid_source'},400)
  const actor=msg.actor_user_id
  if(typeof actor!=='string'||!USER.test(actor)||!allowed(env.JPDA_BRIDGE_ALLOWED_USERS,actor))
    return json({ok:false,error:'actor_not_authorized'},403)
  const member=await env.DB.prepare('SELECT household_id,user_id FROM household_members WHERE user_id=?1 LIMIT 1').bind(actor).first()
  if(!member)return json({ok:false,error:'member_not_found'},403)
  const p=msg.payload
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>150||!safeDate(p.dueOn)||
    !['private','household'].includes(p.visibility)||p.remindEnabled===undefined||typeof p.remindEnabled!=='boolean')
    return json({ok:false,error:'invalid_task'},400)
  if(p.assignee!=null && (typeof p.assignee!=='string'||!USER.test(p.assignee)))
    return json({ok:false,error:'invalid_assignee'},400)
  if(p.visibility==='private'&&p.assignee && p.assignee!==actor)return json({ok:false,error:'private_assignment_forbidden'},403)
  const id=await stableUuid(msg.idempotency_key)
  const body={title:p.title,notes:'文书助手确认事项',visibility:p.visibility,dueOn:p.dueOn,
    assigneeUserId:p.assignee||null,remindEnabled:p.remindEnabled,clientRequestId:id,bonusPoints:0}
  const session={user_id:member.user_id,household_id:member.household_id}
  const delegated=new Request(new URL('/api/tasks',request.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  const response=await tasksRoute(delegated,env.DB,'/api/tasks',session)
  const result=await response.json().catch(()=>({}))
  if(!response.ok||!result.ok||!result.id)return json({ok:false,error:result.error||'target_rejected'},response.status>=400?response.status:503)
  if(!result.replayed){
    try{if(p.visibility==='household')await bumpHouseholdRevision(env.DB,session)
      else await bumpMemberRevision(env.DB,session)}catch{ /* successful task is authoritative; do not retry insertion */ }
  }
  return json({ok:true,remote_id:result.id,reused:!!result.replayed})
}
