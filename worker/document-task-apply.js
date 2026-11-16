// Isolated P0-2 target D1 kernel: intentionally NOT registered as any HTTP
// route. A future signed Service Binding must verify the CURRENT document source
// and immutable task snapshot before calling this helper. Never trust browser
// claimed approval, actor, household or frozen task fields.
import {validated,validateRefs} from './tasks.js';
import {householdWalletSql} from './points-wallet.js';
import {sha256,constantEqualHex,nowMs} from './security.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id32=/^[a-f0-9]{32}$/;
const hex=/^[a-f0-9]{64}$/;
const keys=(x,allowed)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===allowed.slice().sort().join(',');
const core=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
const full=[...core,'operation_sha256','execution_nonce'];
const taskKeys=['operation','title','dueOn','visibility','assignee','bonusPoints','remindEnabled'];
const fail=code=>({ok:false,applied:false,code});
const on=env=>env.APP_ENV==='production'&&env.APPROVALS_ENABLED==='true'&&
 env.APPROVAL_EXECUTION_ENABLED==='true'&&env.APPROVAL_VERIFICATION_ENABLED==='true'&&
 env.DOCUMENT_TASK_EXECUTION_ENABLED==='true'&&typeof env.DB?.prepare==='function';
const same=(r,b)=>r&&r.request_id===b.request_id&&r.candidate_id===b.resource_id&&
 r.household_id===b.household_id&&r.requester_user_id===b.requester_user_id&&
 r.payload_sha256===b.payload_sha256&&
 (b.operation_sha256===undefined||r.operation_sha256===b.operation_sha256);
const receipt=(r,replayed)=>({ok:true,applied:true,approval_id:r.request_id,
 candidate_id:r.candidate_id,household_id:r.household_id,
 requester_user_id:r.requester_user_id,approver_user_id:r.approver_user_id,
 payload_sha256:r.payload_sha256,operation_sha256:r.operation_sha256,
 task_id:r.task_id,applied_at:r.applied_at,replayed});
async function lookup(db,b){
 return db.prepare('SELECT * FROM document_task_applied_actions WHERE request_id=? OR candidate_id=? LIMIT 1')
  .bind(b.request_id,b.resource_id).first();
}
export async function documentTaskReceipt(env,b){
 if(!on(env))return fail('task_executor_disabled');
 if(!keys(b,core)||!uuid.test(b.request_id)||!id32.test(b.resource_id)||
  !hex.test(b.payload_sha256)||!b.household_id||!b.requester_user_id)
  return fail('invalid_receipt');
 const r=await lookup(env.DB,b);
 return same(r,b)?receipt(r,true):fail(r?'receipt_conflict':'receipt_not_found');
}
export async function applyDocumentTask(env,b,task){
 if(!on(env))return fail('task_executor_disabled');
 if(!keys(b,full)||!keys(task,taskKeys)||
  !uuid.test(b.request_id)||!id32.test(b.resource_id)||
  !hex.test(b.payload_sha256)||!hex.test(b.operation_sha256)||
  !hex.test(b.execution_nonce)||typeof b.household_id!=='string'||
  !b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||
  b.requester_user_id.length>128)return fail('invalid_execution_request');
 if(!constantEqualHex(await sha256(JSON.stringify(task)),b.operation_sha256))
  return fail('operation_digest_mismatch');
 const db=env.DB,prior=await lookup(db,b);
 if(prior)return same(prior,b)?receipt(prior,true):fail('journal_identity_conflict');
 const r=await db.prepare(
  'SELECT a.*,m.role AS member_role,mu.disabled_at AS member_disabled,'+
  'o.role AS owner_role,ou.disabled_at AS owner_disabled '+
  'FROM household_approval_requests a '+
  'JOIN household_members m ON m.household_id=a.household_id AND m.user_id=a.requester_user_id '+
  'JOIN users mu ON mu.id=m.user_id '+
  'JOIN household_members o ON o.household_id=a.household_id AND o.user_id=a.approver_user_id '+
  'JOIN users ou ON ou.id=o.user_id WHERE a.request_id=? LIMIT 1')
  .bind(b.request_id).first();
 const now=nowMs(),nonceHash=await sha256(b.execution_nonce);
 if(!r||r.status!=='executing'||r.operation!=='document.sync.homeflow'||
  r.source_app!=='jp-document-assistant'||r.target_app!=='homeflow'||
  r.resource_type!=='document_sync_candidate'||
  r.resource_id!==b.resource_id||r.household_id!==b.household_id||
  r.requester_user_id!==b.requester_user_id||
  r.payload_sha256!==b.payload_sha256||
  r.idempotency_key!=='jpda:sync:'+b.resource_id||
  r.member_role!=='member'||r.owner_role!=='owner'||
  r.member_disabled!=null||r.owner_disabled!=null||
  r.requester_user_id===r.approver_user_id||
  !constantEqualHex(r.execution_nonce_hash,nonceHash)||
  r.execution_lease_until<=now||r.expires_at<=now)
  return fail('approval_not_executable');
 const session={household_id:b.household_id,user_id:b.requester_user_id};
 const data=validated({title:task.title,notes:'',dueOn:task.dueOn,
  visibility:task.visibility,assigneeUserId:task.assignee,
  bonusPoints:task.bonusPoints,remindEnabled:task.remindEnabled},session);
 if(task.operation!=='task'||!data||data.title!==task.title||
  data.dueOn!==task.dueOn||data.visibility!==task.visibility||
  data.assignee!==(task.assignee||null)||
  !await validateRefs(db,session,data))
  return fail('task_business_validation_failed');
 const taskId=crypto.randomUUID();
 const sql='INSERT OR IGNORE INTO tasks '+
  '(id,household_id,creator_user_id,assignee_user_id,visibility,title,notes,'+
  'due_on,client_request_id,health_record_type,remind_enabled,bonus_points,second_assignee_user_id) '+
  "SELECT ?,r.household_id,r.requester_user_id,?,?,?,'',?,?,NULL,?,?,NULL "+
  'FROM household_approval_requests r WHERE r.request_id=? '+
  "AND r.status='executing' AND r.operation='document.sync.homeflow' "+
  'AND r.household_id=? AND r.requester_user_id=? '+
  'AND r.execution_nonce_hash=? AND r.execution_lease_until>? AND r.expires_at>? '+
  '(REWARD)';
 const insert=db.prepare(sql.replace('(REWARD)',
  'AND (?=0 OR ?<='+householdWalletSql('r.household_id','r.requester_user_id')+')'))
  .bind(taskId,data.assignee,data.visibility,data.title,data.dueOn,b.request_id,
   data.reminder===false?0:1,data.bonus,b.request_id,b.household_id,
   b.requester_user_id,nonceHash,now,now,data.bonus,data.bonus);
 const journal=db.prepare('INSERT INTO document_task_applied_actions '+
  '(request_id,candidate_id,household_id,requester_user_id,approver_user_id,'+
  'payload_sha256,operation_sha256,task_id,applied_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
   r.approver_user_id,b.payload_sha256,b.operation_sha256,taskId,now);
 // The journal BEFORE INSERT trigger ABORTS the ENTIRE D1 batch if the
 // task was not inserted. Its AFTER INSERT trigger atomically marks applied
 // and appends the real approver event. No phantom status or points awards.
 try{
  const changed=await db.batch([insert,journal]);
  if(changed.length!==2||changed.some(x=>x.meta?.changes!==1))
   return fail('transaction_reconciliation_required');
 }catch{
  const raced=await lookup(db,b).catch(()=>null);
  return same(raced,b)?receipt(raced,true):fail('transaction_failed');
 }
 const row=await lookup(db,b);
 return same(row,b)?receipt(row,false):fail('receipt_pending_reconciliation');
}
