// One-at-a-time UI coordinator: every original approval is independently
// committed/verified by HomeFlow and its target ledger. No cross-D1 atomic
// batch and absolutely no automatic retry after an uncertain response.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function executeApprovedBatch(ids,execute,isCurrent,max=10){
 if(!Array.isArray(ids)||ids.length<1||ids.length>max||
   ids.some(id=>typeof id!=='string'||!uuid.test(id))||
   new Set(ids).size!==ids.length||
   typeof execute!=='function'||typeof isCurrent!=='function')
  return {ok:false,applied:[],stopped_at:null,code:'invalid_original_approval_set'};
 const applied=[];
 for(const id of ids){
  if(!isCurrent())return {ok:false,applied,stopped_at:id,code:'actor_changed'};
  try{
   // No background retries; the server's own immutable approval ID controls
   // readback and fail-closed execution when a network result is ambiguous.
   const receipt=await execute(id);
   if(!isCurrent())return {ok:false,applied,stopped_at:id,code:'actor_changed'};
   if(receipt?.ok!==true||receipt?.applied!==true||
     receipt?.status!=='applied'||receipt?.approval_id!==id||
     typeof receipt?.remote_id!=='string'||!receipt.remote_id)
    return {ok:false,applied,stopped_at:id,code:'receipt_unconfirmed'};
   applied.push(id);
  }catch{
   return {ok:false,applied,stopped_at:id,code:'target_result_unknown'};
  }
 }
 return {ok:true,applied,stopped_at:null,code:null};
}
