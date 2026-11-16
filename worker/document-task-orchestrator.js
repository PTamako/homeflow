// Owner-gated HomeFlow task execution. The target write is committed in
// HomeFlow D1 with the approval event and immutable task journal, never in a
// browser request and never in a financial executor.
import {json,nowMs} from './security.js';
import {applyDocumentTask,documentTaskReceipt} from './document-task-apply.js';
const hex=/^[0-9a-f]{64}$/i,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,status=503)=>json({ok:false,code,applied:false},status);
async function mac(secret,domain,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
async function documentCall(env,mode,body){
 if(typeof env.DOCUMENT_EXECUTION_SERVICE?.fetch!=='function'||
  !hex.test(env.DOCUMENT_EXECUTION_SECRET||''))return null;
 const raw=JSON.stringify(body),stamp=String(nowMs());
 const req=new Request('https://jp-document-assistant.internal/api/internal/document-task/'+mode,{
  method:'POST',redirect:'manual',headers:{'content-type':'application/json',
   accept:'application/json','x-approval-client':'homeflow',
   'x-approval-timestamp':stamp,
   'x-approval-signature':await mac(env.DOCUMENT_EXECUTION_SECRET,
    'homeflow:document-task-'+mode,stamp,raw)},body:raw});
 try{
  const res=await env.DOCUMENT_EXECUTION_SERVICE.fetch(req);
  if(res.status!==200||!res.ok||res.headers.has('location'))return null;
  const text=await res.text();
  return text.length<=2400?JSON.parse(text):null;
 }catch{return null}
}
const core=r=>({request_id:r.request_id,resource_id:r.resource_id,
 household_id:r.household_id,requester_user_id:r.requester_user_id,
 payload_sha256:r.payload_sha256});
export async function reconcileDocumentTaskReceipt(env,row){
 if(env.DOCUMENT_TASK_EXECUTION_ENABLED!=='true')return false;
 const receipt=await documentTaskReceipt(env,core(row));
 if(!receipt?.applied||!uuid.test(receipt.task_id)||receipt.task_id!==row.remote_id)
  return false;
 const result=await documentCall(env,'receipt',{
  ...core(row),operation_sha256:receipt.operation_sha256,
  task_id:receipt.task_id,approver_user_id:receipt.approver_user_id,
  applied_at:receipt.applied_at});
 return result?.ok===true&&result.applied===true&&result.task_id===receipt.task_id;
}
export async function runDocumentTaskExecution(env,row,nonce,receiptOnly,release){
 if(env.DOCUMENT_TASK_EXECUTION_ENABLED!=='true'||
  typeof env.DOCUMENT_EXECUTION_SERVICE?.fetch!=='function')
  return fail('document_task_execution_disabled');
 if(receiptOnly){
  // Expired approval: reconcile the ORIGINAL journal only, no source prep
  // and no target mutation after the expiry boundary.
  const prior=await documentTaskReceipt(env,core(row));
  if(prior?.applied){
   const acknowledged=await reconcileDocumentTaskReceipt(env,{...row,remote_id:prior.task_id});
   return json({ok:true,applied:true,approval_id:row.request_id,
    remote_id:prior.task_id,status:'already_applied',replayed:true,
    source_receipt_confirmed:acknowledged});
  }
  await release('expired_task_receipt_unknown');
  return fail('expired_task_receipt_unknown');
 }
 const prepared=await documentCall(env,'prepare',{...core(row),execution_nonce:nonce});
 if(!prepared||prepared.ok!==true||prepared.verified!==true||
  prepared.applied!==false||prepared.approval_id!==row.request_id||
  prepared.candidate_id!==row.resource_id||prepared.household_id!==row.household_id||
  prepared.requester_user_id!==row.requester_user_id||
  prepared.payload_sha256!==row.payload_sha256||
  !hex.test(prepared.operation_sha256||'')||!prepared.task){
  await release('document_task_source_unconfirmed');
  return fail('document_task_source_unconfirmed');
 }
 const applied=await applyDocumentTask(env,{...core(row),
  operation_sha256:prepared.operation_sha256,execution_nonce:nonce},prepared.task);
 if(applied?.ok===true&&applied.applied===true&&uuid.test(applied.task_id)){
  const ack=await reconcileDocumentTaskReceipt(env,{...row,remote_id:applied.task_id});
  return json({ok:true,applied:true,status:'applied',approval_id:row.request_id,
   remote_id:applied.task_id,replayed:applied.replayed===true,
   source_receipt_confirmed:ack});
 }
 await release(applied?.code||'document_task_target_unknown');
 return fail('document_task_target_unconfirmed');
}
