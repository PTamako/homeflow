// Current owner may inspect the original sealed member ledger intent before
// approving or rejecting. Browser never gets the encryption key or D1 cipher.
import {json} from './security.js'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const hash=/^[a-f0-9]{64}$/i
const enc=new TextEncoder()
const deny=(code,status=403)=>json({ok:false,error:code},status)
async function signature(secret,stamp,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),v=>parseInt(v,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode('homeflow:shared-entry-preview\n'+stamp+'\n'+raw)))]
  .map(b=>b.toString(16).padStart(2,'0')).join('')
}
export async function householdApprovalDetailRoute(request,env,path,session){
 if(request.method!=='GET')return deny('method_not_allowed',405)
 const id=path.match(/^\/api\/approvals\/([a-f0-9-]{36})\/detail$/i)?.[1]
 if(!id||!uuid.test(id))return deny('not_found',404)
 if(!session?.household_id||!session?.user_id||session.role!=='owner')
  return deny('only_owner_can_view_ledger_detail')
 if(env.APPROVALS_ENABLED!=='true'||!env.DB?.prepare||
  !hash.test(env.SHARED_ENTRY_EXECUTION_SECRET||'')||
  typeof env.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE?.fetch!=='function')
  return deny('approval_detail_unavailable',503)
 const current=await env.DB.prepare(
  'SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id '+
  'WHERE m.household_id=? AND m.user_id=? AND m.role=\'owner\' AND u.disabled_at IS NULL LIMIT 1')
  .bind(session.household_id,session.user_id).first()
 if(!current)return deny('only_owner_can_view_ledger_detail')
 const row=await env.DB.prepare(
  'SELECT request_id,resource_id,household_id,requester_user_id,payload_sha256,operation '+
  'FROM household_approval_requests WHERE request_id=? AND household_id=? '+
  'AND source_app=\'kakebo\' AND target_app=\'kakebo\' '+
  'AND resource_type=\'shared_entry_mutation\' '+
  "AND operation IN ('finance.entry.create','finance.entry.update',"+
  "'finance.entry.delete','finance.entry.restore') LIMIT 1")
  .bind(id,session.household_id).first()
 if(!row||!hash.test(row.payload_sha256||''))return deny('not_found',404)
 const payload={request_id:row.request_id,resource_id:row.resource_id,
  household_id:row.household_id,requester_user_id:row.requester_user_id,
  payload_sha256:row.payload_sha256,approver_user_id:session.user_id}
 const raw=JSON.stringify(payload),stamp=String(Date.now())
 try{
  const response=await env.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE.fetch(new Request(
   'https://kakeibo.internal/api/internal/shared-entries/preview',{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'accept':'application/json','x-approval-client':'homeflow',
    'x-approval-timestamp':stamp,
    'x-approval-signature':await signature(env.SHARED_ENTRY_EXECUTION_SECRET,stamp,raw)},
   body:raw}))
  if(response.status!==200||response.headers.has('location'))
   return deny('approval_detail_unavailable',503)
  const body=await response.text()
  const result=body.length<=3000?JSON.parse(body):null
  if(result?.ok!==true||result.approval_id!==id||
   result.proposal_id!==row.resource_id||result.operation!==row.operation||
   !['create','update','delete','restore'].includes(row.operation.slice(14)))
   return deny('approval_detail_unavailable',503)
  return json({ok:true,approval_id:id,operation:row.operation,
   entry:result.entry||null,before:result.before||null})
 }catch{return deny('approval_detail_unavailable',503)}
}
