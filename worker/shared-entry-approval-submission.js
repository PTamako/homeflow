// Backend-only submission of encrypted, immutable Kakeibo shared-ledger mutation.
// No web form or HomeFlow browser may assert a second user's permission.
import {approvalRoute} from './approvals.js'
import {deliverToHouseholdUser} from './webpush.js'
import {json,nowMs,constantEqualHex} from './security.js'
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i
const deny=(code,status=403)=>json({ok:false,code,applied:false},status)
const exact=(x,k)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.slice().sort().join(',')
async function mac(secret,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode('kakeibo-shared-entry:submit\n'+stamp+'\n'+raw))),
  b=>b.toString(16).padStart(2,'0')).join('')
}
export async function sharedEntryApprovalSubmissionRoute(req,e){
 if(e.APP_ENV!=='production'||e.APPROVALS_ENABLED!=='true'||
  e.SHARED_ENTRY_APPROVAL_SUBMISSION_ENABLED!=='true'||
  !hex.test(e.SHARED_ENTRY_SUBMISSION_SECRET||'')||!e.DB?.prepare)
  return deny('shared_entry_submission_disabled',503)
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||req.headers.get('x-approval-client')!=='kakeibo-shared-entry'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('backend_only')
 const stamp=req.headers.get('x-approval-timestamp')||'',
  signature=req.headers.get('x-approval-signature')||''
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !hex.test(signature))return deny('invalid_signature')
 let b,raw
 try{raw=await req.text();b=raw.length<=850?JSON.parse(raw):null}catch{return deny('invalid_body',400)}
 if(!exact(b,['household_id','requester_user_id','resource_id','payload_sha256',
   'operation','expected_version'])||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128||
  !id.test(b.resource_id)||!hex.test(b.payload_sha256)||
  !['finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore'].includes(b.operation)||
  !Number.isSafeInteger(b.expected_version)||b.expected_version<0||
  (b.operation==='finance.entry.create'?b.expected_version!==0:b.expected_version<1))
  return deny('invalid_shared_mutation_terms',400)
 const computed=await mac(e.SHARED_ENTRY_SUBMISSION_SECRET,stamp,raw)
 if(!constantEqualHex(computed,signature.toLowerCase()))return deny('invalid_signature')
 const key='kakeibo:shared-entry:'+b.resource_id
 const input={source_app:'kakebo',target_app:'kakebo',operation:b.operation,
  resource_type:'shared_entry_mutation',resource_id:b.resource_id,
  payload_sha256:b.payload_sha256,idempotency_key:key,
  payload_schema_version:1,expected_version:b.expected_version}
 const request=new Request(new URL('/api/approvals',req.url),{method:'POST',
  headers:{origin:new URL(req.url).origin,'content-type':'application/json'},body:JSON.stringify(input)})
 const response=await approvalRoute(request,e,'/api/approvals',{
  household_id:b.household_id,user_id:b.requester_user_id})
 if(![200,201].includes(response.status))return response
 const result=await response.json(),approval=result?.request
 if(approval?.applied!==false||!approval?.request_id)return deny('approval_not_confirmed',503)
 const saved=await e.DB.prepare('SELECT * FROM household_approval_requests WHERE request_id=?')
  .bind(approval.request_id).first()
 if(!saved||saved.household_id!==b.household_id||saved.requester_user_id!==b.requester_user_id||
  saved.source_app!=='kakebo'||saved.target_app!=='kakebo'||
  saved.resource_type!=='shared_entry_mutation'||saved.operation!==b.operation||
  saved.resource_id!==b.resource_id||saved.expected_version!==b.expected_version||
  saved.payload_sha256!==b.payload_sha256||saved.idempotency_key!==key)
  return deny('approval_not_confirmed',503)
 // Financial approval remains committed even if the optional iOS push fails.
 // The owner sees it in HomeFlow approvals; push/inbox is only a reminder.
 if(saved.status==='pending'&&result.replayed!==true){
  try{
   const owner=await e.DB.prepare(`SELECT m.user_id FROM household_members m
      JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
      WHERE m.household_id=? AND m.role='owner' LIMIT 1`)
    .bind(saved.household_id).first();
   if(owner?.user_id&&owner.user_id!==saved.requester_user_id){
    const title='家計簿 · 家庭账本待审核'
    const action=saved.operation==='finance.entry.create'?'新增':
     saved.operation==='finance.entry.update'?'修改':
     saved.operation==='finance.entry.delete'?'删除':'恢复'
    const message='家庭成员申请'+action+'账本明细，请在 HomeFlow 家庭管理中审核。'
    await deliverToHouseholdUser(e,saved.household_id,owner.user_id,{
     title,body:message,url:'/',tag:'household-ledger-approval-'+saved.request_id,
     priority:'normal',recordInInbox:true
    },'household-ledger-approval:'+saved.request_id,Date.now(),{
     id:saved.request_id,senderId:saved.requester_user_id,
     kind:'family',sourceId:saved.request_id,title,message,
     dedupeKey:'household-ledger-approval:'+saved.request_id
    })
   }
  }catch{console.warn('homeflow_ledger_approval_notification_failed')}
 }
 return json({ok:true,approval_id:saved.request_id,status:saved.status,
  household_id:saved.household_id,requester_user_id:saved.requester_user_id,
  resource_id:saved.resource_id,payload_sha256:saved.payload_sha256,
  operation:saved.operation,expected_version:saved.expected_version,
  applied:false,replayed:result.replayed===true},response.status)
}
