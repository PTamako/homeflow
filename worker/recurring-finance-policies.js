// DRAFT: owner approval of a member's *monthly* financial plan policy.
// No Cron, bank transfer, securities order, points credit, or ledger execution.
import {json,nowMs,sameOrigin,sha256} from './security.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id32=/^[a-f0-9]{32}$/;
const hex=/^[a-f0-9]{64}$/;
const ikey=/^[a-zA-Z0-9._:-]{12,128}$/;
const month=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(s);
const invalid=(code,status=409)=>json({ok:false,code,ledger_applied:false},status);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const active=e=>e.APP_ENV==='production'&&e.APPROVALS_ENABLED==='true'&&
 e.RECURRING_FINANCE_AUTH_ENABLED==='true'&&!!e.DB?.prepare;
const view=p=>({
 policy_id:p.policy_id,household_id:p.household_id,
 member_user_id:p.member_user_id,owner_user_id:p.owner_user_id,
 plan_resource_id:p.plan_resource_id,plan_payload_sha256:p.plan_payload_sha256,
 plan_type:p.plan_type,source_account_version:p.source_account_version,
 due_day:p.due_day,max_amount_jpy:p.max_amount_jpy,
 start_month:p.start_month,end_month:p.end_month,
 status:p.status,version:p.version,expires_at:p.expires_at,
 owner_reviewed_at:p.owner_reviewed_at,created_at:p.created_at,
 ledger_applied:false,cron_enabled:false,occurrence_execution_permitted:false
});
async function role(db,household,id){
 const row=await db.prepare('SELECT m.role FROM household_members m JOIN users u ON u.id=m.user_id '+
  'WHERE m.household_id=? AND m.user_id=? AND u.disabled_at IS NULL LIMIT 1')
  .bind(household,id).first();
 return ['owner','member'].includes(row?.role)?row.role:null;
}
async function parse(req){
 if(req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 try{
  const s=await req.text();if(s.length>1400)return null;
  const x=JSON.parse(s);return x&&typeof x==='object'&&!Array.isArray(x)?x:null;
 }catch{return null}
}
const one=(db,session,id,r)=>db.prepare('SELECT * FROM household_recurring_finance_policies '+
 'WHERE policy_id=? AND household_id=? AND (?=\'owner\' OR member_user_id=?) LIMIT 1')
 .bind(id,session.household_id,r,session.user_id).first();
const next24=monthText=>{
 const [y,m]=monthText.split('-').map(Number);
 const now=new Date(Date.UTC(y,m-1,1)),after=new Date(Date.UTC(y+2,m-1,1));
 return now.getTime()<after.getTime();
};
async function create(req,e,session,r){
 if(r!=='member')return invalid('only_member_can_request_recurring_finance',403);
 const x=await parse(req);
 if(!exact(x,['expected_user_id','plan_resource_id','plan_payload_sha256','plan_type',
  'source_account_version','due_day','max_amount_jpy','start_month','end_month',
  'idempotency_key'])||x.expected_user_id!==session.user_id)
  return invalid('recurring_policy_actor_or_body_invalid',400);
 if(!id32.test(x.plan_resource_id)||!hex.test(x.plan_payload_sha256)||
  !['fixed_cost','sbi_tsumitate'].includes(x.plan_type)||
  !Number.isSafeInteger(x.source_account_version)||x.source_account_version<1||
  !Number.isSafeInteger(x.due_day)||x.due_day<1||x.due_day>28||
  !Number.isSafeInteger(x.max_amount_jpy)||x.max_amount_jpy<1||x.max_amount_jpy>10000000||
  !month(x.start_month)||!month(x.end_month)||x.start_month>x.end_month||
  !ikey.test(x.idempotency_key))
  return invalid('recurring_policy_invalid_terms',400);
 const current=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
 const offset=(a,b)=>{const [y,m]=a.split('-').map(Number);const [z,n]=b.split('-').map(Number);return (z-y)*12+n-m};
 if(offset(current,x.start_month)<0||offset(current,x.start_month)>24||
  offset(x.start_month,x.end_month)<0||offset(x.start_month,x.end_month)>24)
  return invalid('recurring_policy_invalid_window',400);
 const scope=await sha256(['recurring-finance-policy',session.household_id,
  session.user_id,x.idempotency_key].join('\0'));
 const existing=await e.DB.prepare('SELECT * FROM household_recurring_finance_policies '+
  'WHERE idempotency_hash=? LIMIT 1').bind(scope).first();
 const matches=p=>p&&p.household_id===session.household_id&&
  p.member_user_id===session.user_id&&p.plan_resource_id===x.plan_resource_id&&
  p.plan_payload_sha256===x.plan_payload_sha256&&p.plan_type===x.plan_type&&
  p.source_account_version===x.source_account_version&&p.due_day===x.due_day&&
  p.max_amount_jpy===x.max_amount_jpy&&p.start_month===x.start_month&&
  p.end_month===x.end_month&&p.idempotency_hash===scope;
 if(existing)return matches(existing)?json({ok:true,policy:view(existing),replayed:true}):
  invalid('recurring_policy_idempotency_conflict');
 const id=crypto.randomUUID(),now=nowMs();
 try{
  const result=await e.DB.prepare(
   'INSERT INTO household_recurring_finance_policies '+
   '(policy_id,household_id,member_user_id,plan_resource_id,plan_payload_sha256,'+
   'plan_type,source_account_version,due_day,max_amount_jpy,start_month,end_month,'+
   'idempotency_hash,last_actor_user_id,created_at,updated_at,expires_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,session.household_id,session.user_id,x.plan_resource_id,
    x.plan_payload_sha256,x.plan_type,x.source_account_version,x.due_day,
    x.max_amount_jpy,x.start_month,x.end_month,scope,session.user_id,
    now,now,now+14*86400000).run();
  const p=await one(e.DB,session,id,r);
  return result.meta?.changes===1&&p?
   json({ok:true,policy:view(p),replayed:false},201):
   invalid('recurring_policy_not_confirmed',503);
 }catch{
  const race=await e.DB.prepare('SELECT * FROM household_recurring_finance_policies '+
   'WHERE idempotency_hash=?').bind(scope).first().catch(()=>null);
  return matches(race)?json({ok:true,policy:view(race),replayed:true}):
   invalid('recurring_policy_conflict');
 }
}
async function decide(req,e,session,r,id,action){
 const x=await parse(req);
 const review=action==='review';
 if(!exact(x,review?['expected_user_id','expected_version','decision']:
  ['expected_user_id','expected_version'])||
  x.expected_user_id!==session.user_id||
  !Number.isSafeInteger(x.expected_version)||x.expected_version<1||
  (review&&!['approve','reject'].includes(x.decision)))
  return invalid('recurring_policy_invalid_decision',400);
 const p=await one(e.DB,session,id,r);
 if(!p)return invalid('recurring_policy_not_found',404);
 if(p.version!==x.expected_version)return invalid('recurring_policy_version_changed');
 if(review&&r!=='owner')return invalid('recurring_policy_owner_required',403);
 if(action==='cancel'&&(r!=='member'||p.member_user_id!==session.user_id))
  return invalid('recurring_policy_member_required',403);
 if(action==='revoke'&&!(r==='owner'||p.member_user_id===session.user_id))
  return invalid('recurring_policy_revoke_denied',403);
 const next=review?(x.decision==='approve'?'approved':'rejected'):
  action==='cancel'?'cancelled':'revoked';
 const previous=action==='revoke'?'approved':'pending_owner';
 if(p.status!==previous)return invalid('recurring_policy_not_mutable');
 const now=nowMs();
 if(review&&now>=p.expires_at)return invalid('recurring_policy_review_expired');
 try{
  const result=await e.DB.prepare(
   'UPDATE household_recurring_finance_policies SET status=?,last_actor_user_id=?,'+
   'owner_user_id=CASE WHEN ?=1 THEN ? ELSE owner_user_id END,'+
   'owner_reviewed_at=CASE WHEN ?=1 THEN ? ELSE owner_reviewed_at END,'+
   'updated_at=?,version=version+1 '+
   'WHERE policy_id=? AND household_id=? AND status=? AND version=? '+
   'AND (?=0 OR expires_at>?)')
   .bind(next,session.user_id,review?1:0,session.user_id,
    review?1:0,now,now,id,session.household_id,previous,
    x.expected_version,review?1:0,now).run();
  if(result.meta?.changes!==1)return invalid('recurring_policy_transition_conflict');
  const changed=await one(e.DB,session,id,r);
  return changed?json({ok:true,policy:view(changed)}):
   invalid('recurring_policy_transition_unconfirmed',503);
 }catch{return invalid('recurring_policy_transition_conflict')}
}
export async function recurringFinancePoliciesRoute(req,e,path,session){
 if(!active(e))return invalid('recurring_policy_disabled',503);
 if(!session?.household_id||!session.user_id)return invalid('not_authenticated',401);
 const r=await role(e.DB,session.household_id,session.user_id);
 if(!r)return invalid('recurring_policy_identity_revoked',403);
 const root='/api/recurring-finance/policies';
 if(req.method==='GET'){
  if(path===root){
   const a=await e.DB.prepare('SELECT * FROM household_recurring_finance_policies '+
    'WHERE household_id=? AND (?=\'owner\' OR member_user_id=?) '+
    'ORDER BY created_at DESC LIMIT 30')
    .bind(session.household_id,r,session.user_id).all();
   return json({ok:true,items:(a.results||[]).map(view),ledger_applied:false});
  }
  const m=new RegExp('^'+root+'/([a-f0-9-]{36})$','i').exec(path);
  if(!m||!uuid.test(m[1]))return invalid('not_found',404);
  const p=await one(e.DB,session,m[1],r);
  return p?json({ok:true,policy:view(p)}):invalid('not_found',404);
 }
 if(req.method!=='POST'||!sameOrigin(req))return invalid('recurring_policy_origin_or_method',403);
 if(path===root)return create(req,e,session,r);
 const m=new RegExp('^'+root+'/([a-f0-9-]{36})/(review|cancel|revoke)$','i').exec(path);
 return m&&uuid.test(m[1])?decide(req,e,session,r,m[1],m[2]):
  invalid('not_found',404);
}
