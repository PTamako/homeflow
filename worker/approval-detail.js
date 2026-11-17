// Owner-only preview of an immutable household-ledger approval before it
// changes state. Each source decrypts its own sealed intent through a signed,
// private Service Binding. This module cannot mutate Kakeibo or document data.
import {json} from './security.js'
import {ownerReviewAllowed} from './approval-scope.js'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const hash=/^[a-f0-9]{64}$/i
const enc=new TextEncoder()
const deny=(code,status=403)=>json({ok:false,error:code},status)

async function signature(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),v=>parseInt(v,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(b=>b.toString(16).padStart(2,'0')).join('')
}
const core=row=>({request_id:row.request_id,resource_id:row.resource_id,
 household_id:row.household_id,requester_user_id:row.requester_user_id,
 payload_sha256:row.payload_sha256})
const isShared=row=>row.source_app==='kakebo'&&
 row.resource_type==='shared_entry_mutation'&&
 ['finance.entry.create','finance.entry.update','finance.entry.delete',
  'finance.entry.restore'].includes(row.operation)
const isDocument=row=>row.source_app==='jp-document-assistant'&&
 row.resource_type==='document_sync_candidate'&&row.operation==='document.sync.finance'

export async function previewVerifiedLedgerIntent(env,row,approverUserId){
 if(!ownerReviewAllowed(row)||!uuid.test(row.request_id||'')||
    !hash.test(row.payload_sha256||'')||!row.resource_id||
    !row.household_id||!row.requester_user_id||!approverUserId||
    approverUserId===row.requester_user_id)return null
 const shared=isShared(row),document=isDocument(row)
 const service=document?env.DOCUMENT_EXECUTION_SERVICE:
  env.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE
 const secret=document?env.DOCUMENT_EXECUTION_SECRET:env.SHARED_ENTRY_EXECUTION_SECRET
 const domain=document?'homeflow:document-preview':
  shared?'homeflow:shared-entry-preview':'homeflow:ledger-preview'
 const path=document?'/api/internal/document-actions/preview':
  shared?'/api/internal/shared-entries/preview':'/api/internal/approval-preview'
 const payload=document?core(row):shared?{...core(row),approver_user_id:approverUserId}:
  {...core(row),approver_user_id:approverUserId,operation:row.operation,
   resource_type:row.resource_type}
 if(!hash.test(secret||'')||typeof service?.fetch!=='function')return null
 const raw=JSON.stringify(payload),stamp=String(Date.now())
 try{
  const response=await service.fetch(new Request(
   (document?'https://jp-document-assistant.internal':'https://kakeibo.internal')+path,{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'accept':'application/json','x-approval-client':'homeflow',
    'x-approval-timestamp':stamp,
    'x-approval-signature':await signature(secret,domain,stamp,raw)},
   body:raw}))
  if(response.status!==200||response.headers.has('location'))return null
  const text=await response.text()
  const result=text.length<=3000?JSON.parse(text):null
  if(result?.ok!==true||result.approval_id!==row.request_id||
     result.proposal_id!==row.resource_id||result.operation!==row.operation||
     (!result.entry&&!result.before))return null
  // Only the authenticated owner's browser sees these reviewed, non-secret
  // fields. No raw ciphertext, personal account IDs or signature is returned.
  const valid=v=>v===null||v===undefined||v&&typeof v==='object'&&!Array.isArray(v)&&
   Number.isSafeInteger(Number(v.amount))&&Number(v.amount)>0&&
   ['income','expense','transfer'].includes(v.type)&&
   typeof v.date==='string'&&/^20\d{2}-\d\d-\d\d$/.test(v.date)
  if(!valid(result.entry)||!valid(result.before))return null
  return {entry:result.entry||null,before:result.before||null}
 }catch{return null}
}

export async function householdApprovalDetailRoute(request,env,path,session){
 if(request.method!=='GET')return deny('method_not_allowed',405)
 const id=path.match(/^\/api\/approvals\/([a-f0-9-]{36})\/detail$/i)?.[1]
 if(!id||!uuid.test(id))return deny('not_found',404)
 if(!session?.household_id||!session?.user_id||session.role!=='owner')
  return deny('only_owner_can_view_ledger_detail')
 if(env.APPROVALS_ENABLED!=='true'||!env.DB?.prepare)
  return deny('approval_detail_unavailable',503)
 const current=await env.DB.prepare(
  'SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id '+
  'WHERE m.household_id=? AND m.user_id=? AND m.role=\'owner\' AND u.disabled_at IS NULL LIMIT 1')
  .bind(session.household_id,session.user_id).first()
 if(!current)return deny('only_owner_can_view_ledger_detail')
 const row=await env.DB.prepare('SELECT * FROM household_approval_requests '+
  'WHERE request_id=? AND household_id=? LIMIT 1')
  .bind(id,session.household_id).first()
 if(!row||!ownerReviewAllowed(row))return deny('not_found',404)
 const preview=await previewVerifiedLedgerIntent(env,row,session.user_id)
 if(!preview)return deny('approval_detail_unavailable',503)
 return json({ok:true,approval_id:id,operation:row.operation,...preview})
}
