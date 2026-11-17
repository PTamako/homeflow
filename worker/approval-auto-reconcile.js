// Owner-approved household ledger writes: bounded recovery on the existing hourly Cron.
// Never creates a new approval, touches personal assets, or bypasses the target's
// immutable request-ID execution journal. A lease/CAS prevents overlapping runs.
import {approvalExecutionRoute} from './approval-execution.js'
import {nowMs} from './security.js'

const ORIGIN='https://homeflow.internal'
const RETRY_DELAY_MS=2*60*1000
const MAX_ATTEMPTS=6
const MAX_PER_RUN=4

export async function reconcileApprovedSharedEntries(env,execute=approvalExecutionRoute){
 const empty={attempted:0,applied:0,changedHouseholds:[]}
 if(env.APPROVALS_ENABLED!=='true'||env.APPROVAL_EXECUTION_ENABLED!=='true'||
    env.SHARED_ENTRY_APPROVAL_EXECUTION_ENABLED!=='true'||
    !env.DB?.prepare||typeof env.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE?.fetch!=='function')
  return empty
 const stamp=nowMs()
 const rows=(await env.DB.prepare(
  "SELECT request_id,household_id,approver_user_id FROM household_approval_requests "+
  "WHERE source_app='kakebo' AND target_app='kakebo' "+
  "AND resource_type='shared_entry_mutation' "+
  "AND operation IN ('finance.entry.create','finance.entry.update',"+
  "'finance.entry.delete','finance.entry.restore') "+
  "AND status IN ('approved','failed_retryable') AND expires_at>? "+
  "AND updated_at<? AND execution_attempts<? "+
  "ORDER BY updated_at ASC LIMIT ?")
  .bind(stamp,stamp-RETRY_DELAY_MS,MAX_ATTEMPTS,MAX_PER_RUN).all()).results||[]
 const changed=new Set()
 let attempted=0,applied=0
 for(const row of rows){
  if(!row.request_id||!row.household_id||!row.approver_user_id)continue
  const path='/api/approvals/'+row.request_id+'/execute'
  const request=new Request(ORIGIN+path,{method:'POST',
   headers:{origin:ORIGIN,'content-type':'application/json'},body:'{}'})
  attempted++
  try{
   // The normal execution route rechecks the current owner/member roles,
   // claim lease, sealed proposal and target receipt before writing applied.
   const response=await execute(request,env,path,{
    household_id:row.household_id,user_id:row.approver_user_id,role:'owner'
   })
   if(!response.ok)continue
   const receipt=await response.json().catch(()=>null)
   if(receipt?.applied===true&&receipt.approval_id===row.request_id){
    applied++
    changed.add(row.household_id)
   }
  }catch{/* Leave the same immutable approval retryable; never fabricate success. */}
 }
 return {attempted,applied,changedHouseholds:[...changed]}
}
