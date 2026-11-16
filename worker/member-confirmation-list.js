// Member-only, five-item personal confirmation inbox.
// This cannot read the owner's household approval feed and cannot modify records.
// Each row is restricted to the authenticated member's own involvement.
import {json} from './security.js'

const PAGE_SIZE=5
const reject=(code,status=403)=>json({ok:false,code},status)
const approvals=`SELECT 'approval' AS kind,request_id AS id,
 requester_user_id AS actor_user_id,NULL AS recipient_user_id,
 status,created_at,expires_at,version,operation,NULL AS plan_type,
 NULL AS amount_jpy,NULL AS due_day,NULL AS start_month,NULL AS end_month,
 0 AS priority
 FROM household_approval_requests
 WHERE household_id=?1 AND requester_user_id=?2 AND status='pending' AND expires_at>?3`
const policies=`SELECT 'recurring' AS kind,policy_id AS id,
 member_user_id AS actor_user_id,NULL AS recipient_user_id,
 status,created_at,expires_at,version,NULL AS operation,plan_type,
 max_amount_jpy AS amount_jpy,due_day,start_month,end_month,
 0 AS priority
 FROM household_recurring_finance_policies
 WHERE household_id=?1 AND member_user_id=?2
 AND status='pending_owner' AND expires_at>?3`
const consents=`SELECT 'consent' AS kind,consent_id AS id,
 source_user_id AS actor_user_id,recipient_user_id,status,
 created_at,expires_at,version,NULL AS operation,NULL AS plan_type,
 NULL AS amount_jpy,NULL AS due_day,NULL AS start_month,NULL AS end_month,
 CASE WHEN status='awaiting_recipient' THEN 0 ELSE 1 END AS priority
 FROM household_cross_member_transfer_consents
 WHERE household_id=?1 AND
 ((source_user_id=?2 AND status IN ('awaiting_recipient','recipient_accepted'))
 OR (recipient_user_id=?2 AND status='awaiting_recipient')) AND expires_at>?3`

export async function memberConfirmationListRoute(request,env,path,session){
 if(path!=='/api/my-confirmations'||request.method!=='GET')
  return reject('not_found',404)
 if(!session?.user_id||!session.household_id)return reject('not_authenticated',401)
 if(env.APPROVALS_ENABLED!=='true'||!env.DB?.prepare)return reject('approvals_disabled',503)
 const role=await env.DB.prepare('SELECT m.role FROM household_members m '+
  'JOIN users u ON u.id=m.user_id WHERE m.household_id=? AND m.user_id=? '+
  'AND u.disabled_at IS NULL LIMIT 1').bind(session.household_id,session.user_id).first()
 if(role?.role!=='member')return reject('personal_confirmation_member_only',403)
 const raw=new URL(request.url).searchParams.get('page')??'0'
 if(!/^(0|[1-9][0-9]{0,2})$/.test(raw)||Number(raw)>200)
  return reject('invalid_page',400)
 const page=Number(raw),sources=[approvals]
 if(env.RECURRING_FINANCE_AUTH_ENABLED==='true')sources.push(policies)
 if(env.CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED==='true')sources.push(consents)
 try{
  const query='SELECT * FROM ('+sources.join(' UNION ALL ')+
   ') ORDER BY priority ASC,created_at DESC,id DESC LIMIT ?4 OFFSET ?5'
  const values=(await env.DB.prepare(query).bind(
   session.household_id,session.user_id,Date.now(),PAGE_SIZE+1,page*PAGE_SIZE).all()).results||[]
  return json({ok:true,items:values.slice(0,PAGE_SIZE).map(({priority,...item})=>item),
   page,page_size:PAGE_SIZE,has_more:values.length>PAGE_SIZE})
 }catch{return reject('personal_confirmations_unavailable',503)}
}
