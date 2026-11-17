// Poll the read-only approval status, never the ledger execution endpoint.
// A single delayed timer is armed only while visible unresolved reviews exist.
// Each completed fetch re-evaluates the current statuses; settled rows stop
// the timer immediately. Reusing one timer avoids overlapping D1 reads.
export const APPROVAL_RECONCILE_POLL_MS=20_000
const unresolved=new Set(['approved','executing','failed_retryable'])
export function needsApprovalReconciliation(rows,predicate=()=>true){
 return Array.isArray(rows)&&rows.some(row=>predicate(row)&&unresolved.has(row?.status))
}
export function createConditionalApprovalPoller({
 shouldPoll,onRefresh,intervalMs=APPROVAL_RECONCILE_POLL_MS,
 schedule=setTimeout,cancel=clearTimeout
}){
 let timer=null,running=false,disposed=false
 function stop(){
  if(timer!==null){cancel(timer);timer=null}
 }
 function sync(){
  stop()
  if(disposed||running||!shouldPoll())return
  timer=schedule(async()=>{
   timer=null
   if(disposed||!shouldPoll())return
   running=true
   try{await onRefresh()}catch{/* Keep existing status; retry only while unresolved. */}
   finally{running=false;sync()}
  },intervalMs)
 }
 function dispose(){disposed=true;stop()}
 return {sync,stop,dispose}
}
