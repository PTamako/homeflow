// Unified, owner-only family approval list. One scoped D1 read per five rows.
// Read-only: mutations keep using the original, audited resource endpoints.
import {json} from './security.js'
import {ledgerOnly,ownerReviewSql} from './approval-scope.js'

const PAGE_SIZE=5
const invalid=(error,status=403)=>json({ok:false,error},status)
const approval=`SELECT 'approval' AS kind,request_id AS id,requester_user_id AS actor_user_id,
 status,created_at,expires_at,version,operation,source_app,resource_type,
 NULL AS plan_type,NULL AS amount_jpy,NULL AS due_day,NULL AS start_month,
 NULL AS end_month,NULL AS recipient_user_id,NULL AS owner_authorizer_user_id,
 CASE WHEN status='pending' AND expires_at>unixepoch('now')*1000 THEN 0 WHEN status IN ('approved','failed_retryable','executing') THEN 1 ELSE 2 END AS priority
 FROM household_approval_requests WHERE household_id=?1
 AND NOT (status='cancelled' AND last_error_code='duplicate_retest_superseded')
 AND NOT EXISTS (SELECT 1 FROM household_approval_hidden_history h
 WHERE h.request_id=household_approval_requests.request_id
 AND h.household_id=household_approval_requests.household_id)
  AND NOT EXISTS (SELECT 1 FROM household_approval_dismissed_history d
   WHERE d.request_id=household_approval_requests.request_id
   AND d.household_id=household_approval_requests.household_id)`
const recurring=`SELECT 'recurring' AS kind,policy_id AS id,member_user_id AS actor_user_id,
 status,created_at,expires_at,version,NULL AS operation,NULL AS source_app,
 NULL AS resource_type,plan_type,max_amount_jpy AS amount_jpy,due_day,start_month,
 end_month,NULL AS recipient_user_id,NULL AS owner_authorizer_user_id,
 CASE WHEN status='pending_owner' AND expires_at>unixepoch('now')*1000 THEN 0 WHEN status='approved' THEN 1 ELSE 2 END AS priority
 FROM household_recurring_finance_policies WHERE household_id=?1`
const consent=`SELECT 'consent' AS kind,consent_id AS id,source_user_id AS actor_user_id,
 status,created_at,expires_at,version,NULL AS operation,NULL AS source_app,
 NULL AS resource_type,NULL AS plan_type,NULL AS amount_jpy,NULL AS due_day,
 NULL AS start_month,NULL AS end_month,recipient_user_id,owner_authorizer_user_id,
 CASE WHEN status IN ('awaiting_recipient','recipient_accepted') AND expires_at>unixepoch('now')*1000 THEN 0
 WHEN status='owner_authorized' THEN 1 ELSE 2 END AS priority
 FROM household_cross_member_transfer_consents WHERE household_id=?1`

export async function householdApprovalListRoute(request,env,path,session){
 if(path!=='/api/household-approvals'||request.method!=='GET')
  return invalid('not_found',404)
 if(!session?.user_id||!session?.household_id)return invalid('not_authenticated',401)
 if(env.APPROVALS_ENABLED!=='true'||!env.DB?.prepare)return invalid('approvals_disabled',503)
 const role=await env.DB.prepare('SELECT m.role FROM household_members m '+
  'JOIN users u ON u.id=m.user_id WHERE m.household_id=? AND m.user_id=? '+
  'AND u.disabled_at IS NULL LIMIT 1').bind(session.household_id,session.user_id).first()
 if(role?.role!=='owner')return invalid('only_owner_can_list_family_approvals',403)
 const url=new URL(request.url),raw=url.searchParams.get('page')??'0'
 if(!/^(0|[1-9][0-9]{0,2})$/.test(raw)||Number(raw)>200)
  return invalid('invalid_page',400)
 const page=Number(raw)
 // Only changes to the shared household ledger require owner approval.
 // Personal recurring plans and cross-member asset consent have independent
 // ownership/confirmation flows and must never appear in this review inbox.
 const sources=[ledgerOnly(env)?approval+ownerReviewSql:approval]
 try{
  const query='SELECT * FROM ('+sources.join(' UNION ALL ')+
   ') ORDER BY priority ASC,created_at DESC,id DESC LIMIT ?2 OFFSET ?3'
  const rows=await env.DB.prepare(query).bind(session.household_id,PAGE_SIZE+1,page*PAGE_SIZE).all()
  const records=rows.results||[]
  return json({ok:true,items:records.slice(0,PAGE_SIZE).map(({priority,...r})=>r),
   has_more:records.length>PAGE_SIZE,page,page_size:PAGE_SIZE})
 }catch{
  return invalid('family_approval_list_unavailable',503)
 }
}
