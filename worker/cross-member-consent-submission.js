// Authenticated Kakeibo member's sealed bank intent -> HomeFlow consent request.
// Reuses the narrow, production-only read-proof key with a separate HMAC domain.
// This creates NO approval, bank transfer or ledger entry; recipient and owner
// must independently confirm from their own HomeFlow sessions.
import {json,nowMs,constantEqualHex} from './security.js'
import {crossMemberTransferConsentsRoute} from './cross-member-transfer-consents.js'

const hex64=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i
const fields=['household_id','requester_user_id','recipient_user_id','resource_id',
 'payload_sha256','source_account_version','recipient_account_version']
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',')
const reject=(code,status=403)=>json({ok:false,code,ledger_applied:false},status)
async function signature(secret,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),
  byte=>parseInt(byte,16)),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const result=await crypto.subtle.sign('HMAC',key,
  new TextEncoder().encode('kakeibo-cross-member:consent-submit\n'+stamp+'\n'+raw))
 return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
}
export async function crossMemberConsentSubmissionRoute(request,e){
 if(e.APP_ENV!=='production'||e.APPROVALS_ENABLED!=='true'||
  e.CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED!=='true'||
  e.CROSS_MEMBER_TRANSFER_PROOF_ENABLED!=='true'||
  !hex64.test(e.CROSS_MEMBER_TRANSFER_PROOF_SECRET||'')||!e.DB?.prepare)
  return reject('cross_transfer_submit_disabled',503)
 if(request.method!=='POST'||request.headers.has('origin')||
  request.headers.has('cookie')||request.headers.has('authorization')||
  request.headers.get('x-approval-client')!=='kakeibo-cross-member'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return reject('backend_only')
 const stamp=request.headers.get('x-approval-timestamp')||''
 const provided=request.headers.get('x-approval-signature')||''
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||!hex64.test(provided))
  return reject('invalid_signature')
 let body,raw
 try{
  raw=await request.text()
  if(raw.length>1150)return reject('invalid_body',400)
  body=JSON.parse(raw)
 }catch{return reject('invalid_body',400)}
 if(!exact(body,fields)||!id32.test(body.resource_id)||
  !hex64.test(body.payload_sha256)||
  typeof body.household_id!=='string'||!body.household_id||body.household_id.length>128||
  typeof body.requester_user_id!=='string'||!body.requester_user_id||
  body.requester_user_id.length>128||
  typeof body.recipient_user_id!=='string'||!body.recipient_user_id||
  body.recipient_user_id.length>128||body.recipient_user_id===body.requester_user_id||
  !Number.isSafeInteger(body.source_account_version)||body.source_account_version<1||
  !Number.isSafeInteger(body.recipient_account_version)||body.recipient_account_version<1)
  return reject('invalid_consent_terms',400)
 const expected=await signature(e.CROSS_MEMBER_TRANSFER_PROOF_SECRET,stamp,raw)
 if(!constantEqualHex(expected,provided.toLowerCase()))return reject('invalid_signature')
 const actors=(await e.DB.prepare('SELECT m.user_id,m.role FROM household_members m '+
  'JOIN users u ON u.id=m.user_id WHERE m.household_id=? '+
  'AND m.user_id IN (?,?) AND u.disabled_at IS NULL')
  .bind(body.household_id,body.requester_user_id,body.recipient_user_id).all()).results||[]
 if(!actors.some(a=>a.user_id===body.requester_user_id&&a.role==='member')||
    !actors.some(a=>a.user_id===body.recipient_user_id&&a.role==='owner'))
  return reject('cross_transfer_actors_not_current',403)
 const path='/api/finance-cross-member/consents'
 const url=new URL(path,request.url)
 const consent={
  expected_user_id:body.requester_user_id,recipient_user_id:body.recipient_user_id,
  resource_id:body.resource_id,payload_sha256:body.payload_sha256,
  source_account_version:body.source_account_version,
  recipient_account_version:body.recipient_account_version,
  source_confirmed:true,idempotency_key:'kakeibo-cross-bank:'+body.resource_id
 }
 const internal=new Request(url,{method:'POST',headers:{
  'content-type':'application/json',origin:url.origin
 },body:JSON.stringify(consent)})
 const result=await crossMemberTransferConsentsRoute(internal,e,path,{
  user_id:body.requester_user_id,household_id:body.household_id
 })
 if(![200,201].includes(result.status))return result
 const data=await result.json(),row=data?.consent
 if(data?.ok!==true||row?.resource_id!==body.resource_id||
  row?.payload_sha256!==body.payload_sha256||
  row?.source_user_id!==body.requester_user_id||
  row?.recipient_user_id!==body.recipient_user_id||
  row?.source_account_version!==body.source_account_version||
  row?.recipient_account_version!==body.recipient_account_version||
  row?.household_id!==body.household_id||
  row?.source_confirmed!==true||row?.ledger_applied!==false||
  row?.execution_permitted!==false)
  return reject('cross_transfer_submit_proof_mismatch',503)
 return json({ok:true,consent:row,replayed:data.replayed===true,
  ledger_applied:false,approval_submitted:false},result.status)
}
