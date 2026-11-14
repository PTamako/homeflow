// Stage D: owner-initiated, leased HomeFlow execution of an ALREADY approved
// household financial intent. Only the target Kakeibo Worker may write entries.
// Remote success is the sole basis for 'applied'; timeout is retryable and
// retries reuse the SAME immutable approval ID, never a new debit.
import {json,nowMs,randomToken,sha256,sameOrigin} from './security.js'
import {runDocumentTaskExecution,reconcileDocumentTaskReceipt} from './document-task-orchestrator.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hex=/^[a-f0-9]{64}$/i
const LEASE_MS=120000
const reply=(data,status=200)=>json(data,status)
const failure=(code,status=409)=>reply({ok:false,code,applied:false},status)
const eventId=()=>crypto.randomUUID()
function enabled(env){
 return env.APP_ENV==='production'&&env.APPROVALS_ENABLED==='true'&&
  env.APPROVAL_EXECUTION_ENABLED==='true'&&
  env.APPROVAL_VERIFICATION_ENABLED==='true'&&
  typeof env.APPROVAL_VERIFICATION_SECRET==='string'&&
  hex.test(env.APPROVAL_VERIFICATION_SECRET)&&
  (typeof env.KAKEIBO_EXECUTION_SERVICE?.fetch==='function'||
   typeof env.DOCUMENT_EXECUTION_SERVICE?.fetch==='function'||
   typeof env.DOCUMENT_STUDY_EXECUTION_SERVICE?.fetch==='function'||
   typeof env.KAKEIBO_CARD_EXECUTION_SERVICE?.fetch==='function'||
   typeof env.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE?.fetch==='function'||
   typeof env.KAKEIBO_PREPAID_EXECUTION_SERVICE?.fetch==='function'||
   typeof env.KAKEIBO_POINTS_EXECUTION_SERVICE?.fetch==='function')&&
  !!env.DB?.prepare
}
async function mac(secret,stamp,raw,receiptOnly=false,documentAction=false,studyAction=false,cardAction=false,settlementAction=false,prepaidAction=false,pointsAction=false){
 const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16))
 const key=await crypto.subtle.importKey('raw',bytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const data=await crypto.subtle.sign('HMAC',key,
  new TextEncoder().encode((pointsAction?
    (receiptOnly?'homeflow:points-receipt':'homeflow:points-execute'):
   prepaidAction?
    (receiptOnly?'homeflow:prepaid-receipt':'homeflow:prepaid-execute'):
   settlementAction?
    (receiptOnly?'homeflow:card-settlement-receipt':'homeflow:card-settlement-execute'):
   cardAction?
    (receiptOnly?'homeflow:card-receipt':'homeflow:card-execute'):
   studyAction?
    (receiptOnly?'homeflow:document-study-receipt':'homeflow:document-study-execute'):
   documentAction?
    (receiptOnly?'homeflow:document-receipt':'homeflow:document-execute'):
    (receiptOnly?'homeflow:receipt':'homeflow'))+'\n'+stamp+'\n'+raw))
 return Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,'0')).join('')
}
async function statusChange(db,row,session,newStatus,errorCode=null,remoteId=null,remoteAppliedAt=null){
 const stamp=nowMs()
 try{
  const changes=await db.batch([
   db.prepare('UPDATE household_approval_requests SET status=?,updated_at=?,'+
    'executed_at=CASE WHEN ?=\'applied\' THEN ? ELSE executed_at END,'+
    'execution_nonce_hash=NULL,execution_lease_until=NULL,'+
    'remote_id=CASE WHEN ?=\'applied\' THEN ? ELSE remote_id END,'+
    'last_error_code=?,version=version+1 '+
    "WHERE request_id=? AND household_id=? AND status='executing' "+
    'AND execution_nonce_hash=?')
    .bind(newStatus,stamp,newStatus,remoteAppliedAt??stamp,newStatus,remoteId,errorCode,
     row.request_id,row.household_id,row.execution_nonce_hash),
   db.prepare('INSERT INTO household_approval_events '+
    '(event_id,request_id,actor_user_id,actor_type,action,created_at) '+
    'SELECT ?,request_id,?, ?,?,? FROM household_approval_requests '+
    'WHERE request_id=? AND changes()=1')
    .bind(eventId(),session.user_id,'integration',newStatus,stamp,row.request_id)
  ])
  return changes.length===2&&changes.every(x=>x.meta?.changes===1)
 }catch{return false}
}
async function expiredLease(db,row,session){
 // A Worker can die after claiming and before sending the remote request.
 // Release ONLY an expired lease; if the remote applied just before timeout,
 // the target's immutable idempotency journal returns already_applied on retry.
 const stamp=nowMs()
 try{
  const changes=await db.batch([
   db.prepare("UPDATE household_approval_requests SET status='failed_retryable',"+
    "last_error_code='execution_lease_expired',execution_nonce_hash=NULL,"+
    "execution_lease_until=NULL,updated_at=?,version=version+1 "+
    "WHERE request_id=? AND household_id=? AND status='executing' "+
    'AND execution_nonce_hash=? AND execution_lease_until<=?')
    .bind(stamp,row.request_id,row.household_id,row.execution_nonce_hash,stamp),
   db.prepare('INSERT INTO household_approval_events '+
    '(event_id,request_id,actor_user_id,actor_type,action,created_at) '+
    "SELECT ?,request_id,?,'integration','failed_retryable',? "+
    'FROM household_approval_requests WHERE request_id=? AND changes()=1')
    .bind(eventId(),session.user_id,stamp,row.request_id)
  ])
  return changes.every(x=>x.meta?.changes===1)
 }catch{return false}
}
async function ownerApproval(db,id,session){
 return db.prepare('SELECT r.*,owner.role AS owner_role,owner_user.disabled_at AS owner_disabled,'+
  'member.role AS member_role,member_user.disabled_at AS member_disabled '+
  'FROM household_approval_requests r '+
  'JOIN household_members owner ON owner.household_id=r.household_id '+
  'AND owner.user_id=r.approver_user_id '+
  'JOIN users owner_user ON owner_user.id=r.approver_user_id '+
  'JOIN household_members member ON member.household_id=r.household_id '+
  'AND member.user_id=r.requester_user_id '+
  'JOIN users member_user ON member_user.id=r.requester_user_id '+
  'WHERE r.request_id=? AND r.household_id=? AND r.approver_user_id=? LIMIT 1')
  .bind(id,session.household_id,session.user_id).first()
}
export async function approvalExecutionRoute(request,env,path,session){
 if(!enabled(env))return failure('execution_disabled',503)
 if(request.method!=='POST'||!sameOrigin(request))return failure('method_or_origin',403)
 const m=/^\/api\/approvals\/([0-9a-f-]{36})\/execute$/.exec(path)
 if(!m||!uuid.test(m[1]))return failure('not_found',404)
 if(!session?.household_id||!session?.user_id||session.role!=='owner')
  return failure('owner_required',403)
 let body
 try{const raw=await request.text();body=raw.length<20?JSON.parse(raw):null}
 catch{return failure('invalid_body',400)}
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).length!==0)return failure('invalid_body',400)
 const db=env.DB
 let row=await ownerApproval(db,m[1],session)
 if(!row)return failure('not_found',404)
 if(row.owner_role!=='owner'||row.owner_disabled!=null||
  row.member_role!=='member'||row.member_disabled!=null||
  row.requester_user_id===session.user_id)
  return failure('current_membership_invalid',403)
 const cash=row.target_app==='kakebo'&&row.source_app==='kakebo'&&
  row.operation==='finance.entry.create'&&row.resource_type==='finance_entry';
 const card=row.target_app==='kakebo'&&row.source_app==='kakebo'&&
  row.operation==='finance.credit_card.purchase'&&
  row.resource_type==='credit_card_purchase'&&
  row.idempotency_key==='kakeibo:card:'+row.resource_id&&
  Number.isSafeInteger(row.expected_version)&&row.expected_version>=1;
 const points=row.target_app==='kakebo'&&row.source_app==='kakebo'&&
  ['finance.points.earn_campaign','finance.points.earn_purchase',
   'finance.points.redeem_discount','finance.points.redeem_purchase','finance.points.expire',
   'finance.points.transfer_prepaid','finance.points.offset_card',
   'finance.points.transfer_out','finance.points.exchange_out','finance.points.reversal',
   'finance.points.redeem_asset'].includes(row.operation)&&
  row.resource_type==='points_action'&&
  row.idempotency_key==='kakeibo:points:'+row.resource_id&&
  Number.isSafeInteger(row.expected_version)&&row.expected_version>=1;
 const prepaid=row.target_app==='kakebo'&&row.source_app==='kakebo'&&
  (row.operation==='finance.prepaid.topup'||row.operation==='finance.prepaid.spend')&&
  row.resource_type==='prepaid_action'&&
  row.idempotency_key==='kakeibo:prepaid:'+row.resource_id&&
  Number.isSafeInteger(row.expected_version)&&row.expected_version>=1;
 const settlement=row.target_app==='kakebo'&&row.source_app==='kakebo'&&
  row.operation==='finance.credit_card.settlement'&&
  row.resource_type==='credit_card_settlement'&&
  row.idempotency_key==='kakeibo:cardsettle:'+row.resource_id&&
  Number.isSafeInteger(row.expected_version)&&row.expected_version>=1;
 const documentFinance=row.target_app==='kakebo'&&
  row.source_app==='jp-document-assistant'&&
  row.operation==='document.sync.finance'&&
  row.resource_type==='document_sync_candidate';
 const documentTask=row.target_app==='homeflow'&&
  row.source_app==='jp-document-assistant'&&
  row.operation==='document.sync.homeflow'&&
  row.resource_type==='document_sync_candidate';
 const documentStudy=row.target_app==='it-study-platform'&&
  row.source_app==='jp-document-assistant'&&
  row.operation==='document.sync.study'&&
  row.resource_type==='document_sync_candidate'&&
  row.idempotency_key==='jpda:sync:'+row.resource_id;
 if((!cash&&!card&&!settlement&&!prepaid&&!points&&!documentFinance&&!documentTask&&!documentStudy)||!hex.test(row.payload_sha256))
  return failure('operation_not_executable',409);
 if(card&&(env.CARD_APPROVAL_EXECUTION_ENABLED!=='true'||
   !hex.test(env.CARD_EXECUTION_SECRET||'')||
   typeof env.KAKEIBO_CARD_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('card_execution_disabled',503)
 if(points&&(env.POINTS_APPROVAL_EXECUTION_ENABLED!=='true'||
  !hex.test(env.POINTS_EXECUTION_SECRET||'')||
  typeof env.KAKEIBO_POINTS_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('points_execution_disabled',503)
 if(prepaid&&(env.PREPAID_APPROVAL_EXECUTION_ENABLED!=='true'||
  !hex.test(env.PREPAID_EXECUTION_SECRET||'')||
  typeof env.KAKEIBO_PREPAID_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('prepaid_execution_disabled',503)
 if(settlement&&(env.CARD_SETTLEMENT_APPROVAL_EXECUTION_ENABLED!=='true'||
   !hex.test(env.CARD_SETTLEMENT_EXECUTION_SECRET||'')||
   typeof env.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('card_settlement_execution_disabled',503)
 if(cash&&typeof env.KAKEIBO_EXECUTION_SERVICE?.fetch!=='function')
  return failure('execution_disabled',503);
 if(documentFinance&&(env.DOCUMENT_EXECUTION_ENABLED!=='true'||
   !hex.test(env.DOCUMENT_EXECUTION_SECRET||'')||
   typeof env.DOCUMENT_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('document_execution_disabled',503)
 if(documentTask&&(env.DOCUMENT_TASK_EXECUTION_ENABLED!=='true'||
   !hex.test(env.DOCUMENT_EXECUTION_SECRET||'')||
   typeof env.DOCUMENT_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('document_task_execution_disabled',503)
 if(documentStudy&&(env.DOCUMENT_STUDY_EXECUTION_ENABLED!=='true'||
   !hex.test(env.DOCUMENT_STUDY_EXECUTION_SECRET||'')||
   typeof env.DOCUMENT_STUDY_EXECUTION_SERVICE?.fetch!=='function'))
  return failure('document_study_execution_disabled',503)
 if(row.status==='applied'){
  const sourceAck=documentTask?await reconcileDocumentTaskReceipt(env,row):true
  return reply({ok:true,status:'already_applied',approval_id:row.request_id,
   remote_id:row.remote_id,applied:true,replayed:true,
   ...(documentTask?{source_receipt_confirmed:sourceAck}:{})})
 }
 if(row.status==='executing'){
  if(Number(row.execution_lease_until)>nowMs())
   return failure('execution_in_progress',409)
  if(!await expiredLease(db,row,session))return failure('execution_claim_conflict',409)
  row=await ownerApproval(db,m[1],session)
  if(!row)return failure('not_found',404)
 }
 // An expired approval can only reconcile a previous uncertain attempt. It
 // must never be sent to the target's mutation route again after expiry.
 const receiptOnly=Number(row.expires_at)<=nowMs()
 if(!['approved','failed_retryable'].includes(row.status)||
  (receiptOnly&&(row.status!=='failed_retryable'||row.execution_attempts<1)))
  return failure('approval_not_executable',409)
 const nonce=randomToken(),nonceHash=await sha256(nonce)
 const stamp=nowMs(),lease=stamp+LEASE_MS
 try{
  const changes=await db.batch([
   db.prepare("UPDATE household_approval_requests SET status='executing',"+
    "execution_nonce_hash=?,execution_lease_until=?,updated_at=?,"+
    "last_error_code=NULL,execution_attempts=execution_attempts+1,version=version+1 "+
    "WHERE request_id=? AND household_id=? AND approver_user_id=? "+
    "AND ((status IN ('approved','failed_retryable') AND expires_at>?) "+
    "OR (status='failed_retryable' AND execution_attempts>0 AND expires_at<=? AND ?=1))")
    .bind(nonceHash,lease,stamp,row.request_id,row.household_id,session.user_id,stamp,stamp,receiptOnly?1:0),
   db.prepare('INSERT INTO household_approval_events '+
    '(event_id,request_id,actor_user_id,actor_type,action,created_at) '+
    "SELECT ?,request_id,?,'integration','executing',? "+
    'FROM household_approval_requests WHERE request_id=? AND changes()=1')
    .bind(eventId(),session.user_id,stamp,row.request_id)
  ])
  if(changes.some(x=>x.meta?.changes!==1))return failure('execution_claim_conflict',409)
 }catch{return failure('execution_claim_conflict',409)}
 row={...row,execution_nonce_hash:nonceHash,execution_lease_until:lease}
 if(documentTask)return runDocumentTaskExecution(env,row,nonce,receiptOnly,
  async code=>statusChange(db,row,session,'failed_retryable',code))
 const payload={request_id:row.request_id,resource_id:row.resource_id,
  household_id:row.household_id,requester_user_id:row.requester_user_id,
  payload_sha256:row.payload_sha256,...(receiptOnly?{}:{execution_nonce:nonce})}
 const raw=JSON.stringify(payload),timestamp=String(nowMs())
 const outgoing=new Request(points?
   'https://kakeibo.internal/api/internal/points-actions/'+
    (receiptOnly?'receipt':'execute'):
  prepaid?
   'https://kakeibo.internal/api/internal/prepaid-actions/'+
    (receiptOnly?'receipt':'execute'):
  settlement?
   'https://kakeibo.internal/api/internal/card-settlements/'+
    (receiptOnly?'receipt':'execute'):
  card?
   'https://kakeibo.internal/api/internal/card-purchases/'+
    (receiptOnly?'receipt':'execute'):
  documentStudy?
  'https://jp-document-assistant.internal/api/internal/document-study/'+
    (receiptOnly?'receipt':'execute'):
  documentFinance?
  'https://jp-document-assistant.internal/api/internal/document-actions/'+
    (receiptOnly?'receipt':'execute'):
  'https://kakeibo.internal/api/internal/approved-actions/'+
    (receiptOnly?'receipt':'execute'),{
  method:'POST',redirect:'manual',headers:{'content-type':'application/json',
   'accept':'application/json','x-approval-client':'homeflow',
   'x-approval-timestamp':timestamp,
   'x-approval-signature':await mac(points?env.POINTS_EXECUTION_SECRET:prepaid?
    env.PREPAID_EXECUTION_SECRET:settlement?
    env.CARD_SETTLEMENT_EXECUTION_SECRET:card?
    env.CARD_EXECUTION_SECRET:documentStudy?
    env.DOCUMENT_STUDY_EXECUTION_SECRET:documentFinance?
    env.DOCUMENT_EXECUTION_SECRET:env.APPROVAL_VERIFICATION_SECRET,
    timestamp,raw,receiptOnly,documentFinance,documentStudy,card,settlement,prepaid,points)},
  body:raw
 })
 let result=null
 try{
  const response=await (points?env.KAKEIBO_POINTS_EXECUTION_SERVICE:
   prepaid?env.KAKEIBO_PREPAID_EXECUTION_SERVICE:
   settlement?env.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE:
   card?env.KAKEIBO_CARD_EXECUTION_SERVICE:
   documentStudy?env.DOCUMENT_STUDY_EXECUTION_SERVICE:
   documentFinance?env.DOCUMENT_EXECUTION_SERVICE:
   env.KAKEIBO_EXECUTION_SERVICE).fetch(outgoing)
  if(response.status===409){
   // A target 409 does not prove whether an earlier attempt committed and
   // lost its receipt (or whether HomeFlow's execution proof was momentarily
   // unavailable). Never make this approval terminal on an unsigned error.
   // The target's immutable request-ID journal makes the SAME-ID retry safe.
   const released=await statusChange(db,row,session,'failed_retryable',
    'target_conflict_unconfirmed')
   return failure(released?'target_conflict_unconfirmed_safe_to_retry':
    'receipt_reconciliation_required',503)
  }
  if(response.status===200&&response.ok&&!response.headers.has('location')){
   const text=await response.text()
   if(text.length<=1800)result=JSON.parse(text)
  }
 }catch{/* A lost response does NOT prove the target failed to post. */}
 if(result?.ok===true&&result.applied===true&&
  result.approval_id===row.request_id&&
  ((documentStudy||documentFinance)?result.candidate_id:result.proposal_id)===row.resource_id&&
  (!points||(result.approver_user_id===row.approver_user_id&&
   result.actor_user_id===row.approver_user_id&&
   result.operation===row.operation.slice('finance.points.'.length)&&
   /^[a-f0-9]{32}$/i.test(result.points_account_id||'')&&
   result.points_version===row.expected_version&&
   Number.isSafeInteger(result.delta_units)&&result.delta_units!==0&&
   Math.abs(result.delta_units)<=1000000000&&
   Number.isSafeInteger(result.balance_after_units)&&result.balance_after_units>=0&&
   (result.yen_value===null||(Number.isSafeInteger(result.yen_value)&&result.yen_value>=0))&&
   (result.operation==='reversal'?result.delta_units!==0:
    ['earn_campaign','earn_purchase'].includes(result.operation)?
     result.delta_units>0:result.delta_units<0)&&
   (result.operation!=='reversal'||(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
     result.reversed_request_id||'')&&
    result.reversed_request_id!==row.request_id&&
    (result.target_account_id===null?(
      result.refunded_target_account_id===null&&result.refunded_prepaid_account_id===null):(
      /^[a-f0-9]{32}$/i.test(result.target_account_id||'')&&
      result.target_account_id!==result.points_account_id&&
      result.delta_units>0&&(
       (result.refunded_target_account_id===result.target_account_id&&
        result.refunded_prepaid_account_id===null&&
        Number.isSafeInteger(result.refunded_target_units)&&
        result.refunded_target_units>0&&
        Number.isSafeInteger(result.refunded_target_balance_after_units)&&
        result.refunded_target_balance_after_units>=0&&
        Number.isSafeInteger(result.refunded_target_version)&&
        result.refunded_target_version>=1)
       ||
       (result.refunded_prepaid_account_id===result.target_account_id&&
        result.refunded_target_account_id===null&&
        Number.isSafeInteger(result.refunded_prepaid_jpy)&&
        result.refunded_prepaid_jpy>0&&
        result.refunded_prepaid_jpy===result.yen_value&&
        Number.isSafeInteger(result.refunded_prepaid_balance_after_jpy)&&
        result.refunded_prepaid_balance_after_jpy>=0&&
        Number.isSafeInteger(result.refunded_prepaid_version)&&
        result.refunded_prepaid_version>=1)))))&&
   (result.operation!=='redeem_asset'||(
     /^[a-f0-9]{32}$/i.test(result.target_account_id||'')&&
     result.target_account_id!==result.points_account_id&&
     Number.isSafeInteger(result.sbi_securities_version)&&
     result.sbi_securities_version>=1&&
     /^[A-Z0-9]{8}$/.test(result.sbi_fund_code||'')&&
     ['growth','tsumitate'].includes(result.sbi_account_type)&&
     Number.isSafeInteger(result.sbi_confirmed_units)&&
     result.sbi_confirmed_units>0&&result.sbi_confirmed_units<=1000000000000&&
     Number.isSafeInteger(result.sbi_acquisition_cost_jpy)&&
     result.sbi_acquisition_cost_jpy>0&&
     result.sbi_acquisition_cost_jpy===result.yen_value&&
     Number.isSafeInteger(result.sbi_total_units_after)&&
     result.sbi_total_units_after>=result.sbi_confirmed_units&&
     Number.isSafeInteger(result.sbi_total_cost_after_jpy)&&
     result.sbi_total_cost_after_jpy>=result.sbi_acquisition_cost_jpy&&
     /^[a-f0-9]{64}$/i.test(result.sbi_reference_hash||'')&&
     /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(result.sbi_trade_date||'')&&
     result.sbi_evidence_kind==='user_attested_broker_execution'&&
     result.delta_units<0&&result.linked_entry_id===null))&&
   (result.operation!=='transfer_prepaid'||(
     /^[a-f0-9]{32}$/i.test(result.target_account_id||'')&&
     result.target_account_id!==result.points_account_id&&
     Number.isSafeInteger(result.prepaid_version)&&result.prepaid_version>=1&&
     Number.isSafeInteger(result.prepaid_credit_jpy)&&result.prepaid_credit_jpy>0&&
     result.prepaid_credit_jpy===result.yen_value&&
     Number.isSafeInteger(result.prepaid_balance_after_jpy)&&
     result.prepaid_balance_after_jpy>=result.prepaid_credit_jpy))&&
   (result.operation!=='offset_card'||(
     /^[a-f0-9]{32}$/i.test(result.target_account_id||'')&&
     result.target_account_id!==result.points_account_id&&
     /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      result.card_purchase_request_id||'')&&
     Number.isSafeInteger(result.card_version)&&result.card_version>=1&&
     Number.isSafeInteger(result.card_offset_jpy)&&result.card_offset_jpy>0&&
     result.card_offset_jpy===result.yen_value&&
     Number.isSafeInteger(result.card_remaining_after_jpy)&&
     result.card_remaining_after_jpy>=0))&&
   (!['transfer_out','exchange_out'].includes(result.operation)||(
     /^[a-f0-9]{32}$/i.test(result.target_account_id||'')&&
     result.target_account_id!==result.points_account_id&&
     Number.isSafeInteger(result.transfer_target_version)&&result.transfer_target_version>=1&&
     Number.isSafeInteger(result.transfer_target_units)&&
     result.transfer_target_units>0&&result.transfer_target_units<=1000000000&&
     Number.isSafeInteger(result.transfer_target_balance_after_units)&&
     result.transfer_target_balance_after_units>=result.transfer_target_units&&
     Number.isSafeInteger(result.yen_value)&&result.yen_value>0&&
     Number.isSafeInteger(result.transfer_target_rate_numerator)&&
     result.transfer_target_rate_numerator>=1&&
     Number.isSafeInteger(result.transfer_target_rate_denominator)&&
     result.transfer_target_rate_denominator>=1&&
     BigInt(result.transfer_target_units)*BigInt(result.transfer_target_rate_numerator)===
      BigInt(result.yen_value)*BigInt(result.transfer_target_rate_denominator)&&
     (result.operation!=='transfer_out'||result.transfer_target_units===-result.delta_units)))&&
   (result.operation==='reversal'?
     (result.linked_entry_id===null||
      (Number.isSafeInteger(result.linked_entry_id)&&result.linked_entry_id>0)):
    ['earn_purchase','redeem_discount','redeem_purchase'].includes(result.operation)?
     Number.isSafeInteger(result.linked_entry_id)&&result.linked_entry_id>0:
     result.linked_entry_id===null)))&&
  (!prepaid||(result.approver_user_id===row.approver_user_id&&
   result.actor_user_id===row.approver_user_id&&
   result.action===row.operation.slice('finance.prepaid.'.length)&&
   /^[a-f0-9]{32}$/i.test(result.prepaid_account_id||'')&&
   result.prepaid_version===row.expected_version&&
   Number.isSafeInteger(result.amount_jpy)&&result.amount_jpy>0&&
   Number.isSafeInteger(result.balance_after_jpy)&&result.balance_after_jpy>=0&&
   result.delta_jpy===(result.action==='topup'?result.amount_jpy:-result.amount_jpy)&&
   (result.action==='spend'?result.bank_account_id===null:
    /^[a-f0-9]{32}$/i.test(result.bank_account_id||''))&&
   /^20\d{2}-\d{2}-\d{2}$/.test(result.date||'')))&&
  (!settlement||(result.approver_user_id===row.approver_user_id&&
   result.actor_user_id===row.approver_user_id&&
   result.card_version===row.expected_version&&
   /^[a-f0-9]{32}$/i.test(result.card_account_id||'')&&
   /^[a-f0-9]{32}$/i.test(result.bank_account_id||'')&&
   Number.isSafeInteger(result.amount_jpy)&&result.amount_jpy>0&&
   /^20\d{2}-\d{2}-\d{2}$/.test(result.debit_date||'')&&
   result.transfer_entry_id===result.entry_id))&&
  (!card||(result.approver_user_id===row.approver_user_id&&
   result.account_version===row.expected_version&&
   result.account_id&&/^[a-f0-9]{32}$/.test(result.account_id)&&
   Number.isSafeInteger(result.amount_jpy)&&result.amount_jpy>0&&
   /^20\d{2}-\d{2}$/.test(result.bill_month)))&&
  result.household_id===row.household_id&&
  result.requester_user_id===row.requester_user_id&&
  result.payload_sha256===row.payload_sha256&&
  (documentStudy?
    (typeof result.remote_id==='string'&&result.remote_id===row.resource_id&&
     result.approver_user_id===row.approver_user_id):
    points?true:(Number.isSafeInteger(result.entry_id)&&result.entry_id>0))&&
  Number.isSafeInteger(result.applied_at)&&result.applied_at>=Number(row.reviewed_at)&&
  result.applied_at<=nowMs()+60000){
  const remoteId=documentStudy?result.remote_id:points?
    'points:'+result.points_account_id+':'+row.request_id:String(result.entry_id)
  const stored=await statusChange(db,row,session,'applied',null,remoteId,result.applied_at)
  if(stored)return reply({ok:true,status:'applied',approval_id:row.request_id,
   remote_id:remoteId,applied:true,
   replayed:result.already_applied===true})
  return failure('applied_remote_receipt_pending_reconciliation',503)
 }
 const released=await statusChange(db,row,session,'failed_retryable',receiptOnly?'expired_receipt_unknown':'target_result_unknown')
 return failure(released?(receiptOnly?'expired_receipt_unknown':'target_result_unknown_safe_to_retry'):
  'receipt_reconciliation_required',503)
}
