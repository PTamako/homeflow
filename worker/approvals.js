import {json,nowMs,sameOrigin,readBody} from './security.js'

// D1-backed approval intent/review ONLY. This module deliberately has no
// target-app execution privileges. "approved" must never mean "applied".
const ALLOWED_OPS={
  'finance.entry.create':'kakebo',
  'finance.credit_card.purchase':'kakebo',
  'finance.credit_card.settlement':'kakebo',
  'finance.prepaid.topup':'kakebo',
  'finance.prepaid.spend':'kakebo',
  'finance.points.earn_campaign':'kakebo',
  'finance.points.earn_purchase':'kakebo',
  'finance.points.redeem_discount':'kakebo',
  'finance.points.redeem_purchase':'kakebo',
  'finance.points.expire':'kakebo',
 'finance.points.transfer_prepaid':'kakebo',
 'finance.points.offset_card':'kakebo',
 'finance.points.transfer_out':'kakebo',
 'finance.points.exchange_out':'kakebo',
 'finance.points.reversal':'kakebo',
 'finance.points.redeem_asset':'kakebo',
  'finance.entry.update':'kakebo',
  'finance.entry.delete':'kakebo',
  'finance.entry.restore':'kakebo',
  'finance.account.public_rule.change':'kakebo',
  'document.sync.finance':'kakebo',
  'document.sync.homeflow':'homeflow',
  'document.sync.study':'it-study-platform',
  'homeflow.shared_task.create':'homeflow'
}
const APPS=new Set(['homeflow','kakebo','jp-document-assistant','it-study-platform'])
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash=/^[a-f0-9]{64}$/
const requestKey=/^[a-z0-9._:-]{12,128}$/i
const safeResource=/^[a-z0-9:_./-]{1,100}$/i
const DAYS=14
const ENTRY_LIMIT=5
function validSubmission(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return false
 if(!APPS.has(body.source_app)||!Object.hasOwn(ALLOWED_OPS,body.operation)||
    ALLOWED_OPS[body.operation]!==body.target_app)return false
 if(typeof body.resource_type!=='string'||
    !/^[a-z][a-z0-9_-]{0,47}$/i.test(body.resource_type))return false
 if(body.resource_id!=null && (!safeResource.test(body.resource_id)))return false
 if(typeof body.idempotency_key!=='string'||!requestKey.test(body.idempotency_key))return false
 if(typeof body.payload_sha256!=='string'||!hash.test(body.payload_sha256))return false
 if(body.payload_schema_version!==undefined && body.payload_schema_version!==1)return false
 if(body.expected_version!==undefined&&body.expected_version!==null&&
   (!Number.isSafeInteger(body.expected_version)||body.expected_version<0))return false
 if(body.operation.startsWith('finance.entry.') &&
   ['update','delete','restore'].includes(body.operation.split('.').pop()) &&
   (body.expected_version===undefined||body.expected_version===null||
     typeof body.resource_id!=='string'))return false
 // Don't let clients pass amounts, bank details, original documents, SQL or
 // arbitrary target URLs into the permanent HomeFlow approvals journal.
 const keys=Object.keys(body)
 return keys.every(x=>[
   'source_app','target_app','operation','resource_type','resource_id',
   'idempotency_key','payload_sha256','payload_schema_version','expected_version'
 ].includes(x))
}
function publicShape(row){
 return {
  request_id:row.request_id,
  source_app:row.source_app,target_app:row.target_app,
  resource_type:row.resource_type,operation:row.operation,
  resource_id:row.resource_id,requester_user_id:row.requester_user_id,
  approver_user_id:row.approver_user_id,status:row.status,
  expected_version:row.expected_version,
  created_at:row.created_at,reviewed_at:row.reviewed_at,
  executed_at:row.executed_at,expires_at:row.expires_at,
  remote_id:row.remote_id,version:row.version,
  // No payload, token or private document text is returned.
  applied:row.status==='applied'
 }
}
const reject=(reason,status=403)=>json({error:reason},status)
function sameSubmission(existing,session,body){
 return !!existing&&existing.household_id===session.household_id&&
   existing.requester_user_id===session.user_id&&
   existing.source_app===body.source_app&&
   existing.target_app===body.target_app&&
   existing.operation===body.operation&&
   existing.resource_type===body.resource_type&&
   (existing.resource_id||null)===(body.resource_id||null)&&
   existing.payload_sha256===body.payload_sha256&&
   Number(existing.payload_schema_version)===1&&
   (existing.expected_version??null)===(body.expected_version??null)
}
const replayResponse=(row,session,body)=>sameSubmission(row,session,body)
 ?json({request:publicShape(row),replayed:true})
 :reject('idempotency_key_conflict',409)

async function currentRole(db,session){
 if(!session?.user_id||!session?.household_id)return null
 const row=await db.prepare(`SELECT m.role FROM household_members m
  JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
  WHERE m.household_id=?1 AND m.user_id=?2 LIMIT 1`)
   .bind(session.household_id,session.user_id).first()
 return row?.role||null
}
async function readOne(db,id,session,role){
 const row=await db.prepare(`SELECT * FROM household_approval_requests
    WHERE request_id=?1 AND household_id=?2
      AND (?3='owner' OR requester_user_id=?4) LIMIT 1`)
   .bind(id,session.household_id,role,session.user_id).first()
 return row
}
async function submit(request,db,session,role){
 if(role!=='member')return reject('only_member_can_request',403)
 const body=await readBody(request)
 if(!validSubmission(body))return reject('invalid_request',400)
 const stamp=nowMs()
 const requestId=crypto.randomUUID()
 const existing=await db.prepare(`SELECT * FROM household_approval_requests
  WHERE idempotency_key=?1 LIMIT 1`).bind(body.idempotency_key).first()
 if(existing)return replayResponse(existing,session,body)
 const expires=stamp+DAYS*86400000
 let result
 try{
 result=await db.batch([
   db.prepare(`INSERT INTO household_approval_requests
     (request_id,household_id,requester_user_id,source_app,target_app,
      operation,resource_type,resource_id,payload_schema_version,
      payload_sha256,expected_version,idempotency_key,status,created_at,
      expires_at,updated_at)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,'pending',?12,?13,?12)
     ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(requestId,session.household_id,session.user_id,body.source_app,
      body.target_app,body.operation,body.resource_type,body.resource_id||null,
      body.payload_sha256,body.expected_version??null,body.idempotency_key,stamp,expires),
   db.prepare(`INSERT INTO household_approval_events
     (event_id,request_id,actor_user_id,actor_type,action,created_at)
     SELECT ?1,request_id,requester_user_id,'member','submitted',?2
     FROM household_approval_requests WHERE request_id=?3 AND changes()=1`)
    .bind(crypto.randomUUID(),stamp,requestId)
 ])
 }catch{return reject('approval_submission_failed',409)}
 if(Number(result?.[0]?.meta?.changes)!==1||
    Number(result?.[1]?.meta?.changes)!==1){
   // Two devices may both miss the first SELECT, but only one may insert.
   // The losing attempt is a proper idempotent replay only if EVERYTHING
   // matches the committed request; never leak another member's request.
   const raced=await db.prepare(`SELECT * FROM household_approval_requests
       WHERE idempotency_key=?1 LIMIT 1`).bind(body.idempotency_key).first()
   return raced?replayResponse(raced,session,body):reject('approval_conflict',409)
 }
 const row=await db.prepare('SELECT * FROM household_approval_requests WHERE request_id=?1')
   .bind(requestId).first()
 return json({request:publicShape(row),replayed:false},201)
}
async function mutate(request,db,id,session,role,action){
 if(!uuid.test(id))return reject('not_found',404)
 if(action==='review'&&role!=='owner')return reject('only_owner_can_review')
 if(action==='cancel'&&role!=='member')return reject('only_requester_can_cancel')
 let decision=null
 if(action==='review'){
   const body=await readBody(request)
   if(!body||!['approve','reject'].includes(body.decision)||
       Object.keys(body).some(k=>k!=='decision'))return reject('invalid_review',400)
   decision=body.decision==='approve'?'approved':'rejected'
 }
 const row=await readOne(db,id,session,role)
 if(!row)return reject('not_found',404)
 if(row.status!=='pending')return reject('already_reviewed',409)
 const stamp=nowMs()
 if(row.expires_at<=stamp)return reject('approval_expired',409)
 if(action==='review'&&row.requester_user_id===session.user_id)
   return reject('self_approval_forbidden')
 if(action==='cancel'&&row.requester_user_id!==session.user_id)
   return reject('only_requester_can_cancel')
 const newStatus=decision||'cancelled'
 const isReview=action==='review'
 let result
 try{
 result=await db.batch([
   db.prepare(`UPDATE household_approval_requests
     SET status=?1,approver_user_id=?2,
         reviewed_at=CASE WHEN ?7=1 THEN ?3 ELSE reviewed_at END,
         updated_at=?3,version=version+1
     WHERE request_id=?4 AND household_id=?5
       AND status='pending' AND expires_at>?3
       ${isReview?'AND requester_user_id<>?6':'AND requester_user_id=?6'}`)
    .bind(newStatus,isReview?session.user_id:null,stamp,id,
      session.household_id,session.user_id,isReview?1:0),
   db.prepare(`INSERT INTO household_approval_events
     (event_id,request_id,actor_user_id,actor_type,action,created_at)
     SELECT ?1,request_id,?2,?3,?4,?5 FROM household_approval_requests
     WHERE request_id=?6 AND changes()=1`)
    .bind(crypto.randomUUID(),session.user_id,role,newStatus,stamp,id)
 ])
 }catch{return reject('approval_conflict',409)}
 if(Number(result?.[0]?.meta?.changes)!==1||
    Number(result?.[1]?.meta?.changes)!==1)return reject('approval_conflict',409)
 const changed=await readOne(db,id,session,role)
 return json({request:publicShape(changed)})
}
export async function approvalRoute(request,env,path,session){
 // Authenticated client feature discovery needs no approval migration or
 // extra D1 rows. Outer /api session guard applies before this handler.
 if(path==='/api/approvals/status'&&request.method==='GET')
  return json({enabled:env.APPROVALS_ENABLED==='true',
   execution_enabled:env.APPROVALS_ENABLED==='true'&&
    env.APPROVAL_EXECUTION_ENABLED==='true',
   document_execution_enabled:env.APPROVALS_ENABLED==='true'&&
    env.APPROVAL_EXECUTION_ENABLED==='true'&&
    env.APPROVAL_VERIFICATION_ENABLED==='true'&&
    env.DOCUMENT_EXECUTION_ENABLED==='true'&&
    /^[a-f0-9]{64}$/i.test(env.DOCUMENT_EXECUTION_SECRET||'')&&
    /^[a-f0-9]{64}$/i.test(env.DOCUMENT_APPROVAL_VERIFICATION_SECRET||'')&&
    typeof env.DOCUMENT_EXECUTION_SERVICE?.fetch==='function'})
 // No migration applied and no actual target execution in production.
 if(env.APPROVALS_ENABLED!=='true')return reject('approvals_disabled',503)
 const db=env.DB
 if(!db?.prepare)return reject('database_unavailable',503)
 const role=await currentRole(db,session)
 if(!['owner','member'].includes(role))return reject('not_authenticated',401)
 if(request.method==='GET'){
   if(path==='/api/approvals'){
     const url=new URL(request.url)
     const status=url.searchParams.get('status')||''
     if(status&&!['pending','approved','rejected','executing','applied',
       'failed_retryable','failed_final','cancelled','expired','conflict'].includes(status))
       return reject('invalid_filter',400)
     const page=Number(url.searchParams.get('page')||0)
     if(!Number.isInteger(page)||page<0||page>1000)return reject('invalid_page',400)
     const rows=await db.prepare(`SELECT * FROM household_approval_requests
       WHERE household_id=?1 AND (?2='owner' OR requester_user_id=?3)
         AND (?4='' OR status=?4)
       ORDER BY created_at DESC,request_id DESC LIMIT 6 OFFSET ?5`)
       .bind(session.household_id,role,session.user_id,status,page*ENTRY_LIMIT).all()
     const items=rows.results||[]
     return json({items:items.slice(0,ENTRY_LIMIT).map(publicShape),
       has_more:items.length>ENTRY_LIMIT,page})
   }
   const m=/^\/api\/approvals\/([0-9a-f-]{36})$/.exec(path)
   if(!m)return reject('not_found',404)
   const row=await readOne(db,m[1],session,role)
   if(!row)return reject('not_found',404)
   const events=await db.prepare(`SELECT actor_user_id,actor_type,action,created_at
       FROM household_approval_events WHERE request_id=?1
       ORDER BY created_at ASC,event_id ASC LIMIT 100`).bind(row.request_id).all()
   return json({request:publicShape(row),events:events.results||[]})
 }
 if(request.method!=='POST')return reject('method_not_allowed',405)
 if(!sameOrigin(request))return reject('origin_forbidden',403)
 if(path==='/api/approvals')return submit(request,db,session,role)
 const m=/^\/api\/approvals\/([0-9a-f-]{36})\/(review|cancel)$/.exec(path)
 return m?mutate(request,db,m[1],session,role,m[2]):reject('not_found',404)
}
