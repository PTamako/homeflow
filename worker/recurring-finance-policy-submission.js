// Signed Kakeibo member plan -> EXISTING HomeFlow owner review policy.
// This route never approves or executes funds; no cross-origin cookies.
import {recurringFinancePoliciesRoute} from './recurring-finance-policies.js'
import {json,nowMs,constantEqualHex} from './security.js'
const hex=/^[0-9a-f]{64}$/i,id=/^[0-9a-f]{32}$/i
const fail=(code,s=403)=>json({ok:false,code,ledger_applied:false},s)
const fields=['household_id','requester_user_id','plan_resource_id','plan_payload_sha256',
 'plan_type','source_account_version','due_day','max_amount_jpy','start_month','end_month']
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',')
async function sign(secret,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),
  s=>parseInt(s,16)),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const b=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(
  'kakeibo-recurring-policy:submit\n'+stamp+'\n'+raw))
 return [...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('')
}
export async function recurringFinancePolicySubmissionRoute(request,e){
 if(e.APP_ENV!=='production'||e.APPROVALS_ENABLED!=='true'||
  e.RECURRING_FINANCE_AUTH_ENABLED!=='true'||
  e.RECURRING_FINANCE_POLICY_SUBMISSION_ENABLED!=='true'||
  e.RECURRING_LEGACY_OWNER_REVIEW_ENABLED!=='true'||
  !hex.test(e.RECURRING_FINANCE_POLICY_SUBMISSION_SECRET||'')||!e.DB?.prepare)
  return fail('recurring_policy_submission_disabled',503)
 if(request.method!=='POST'||request.headers.has('origin')||
  request.headers.has('cookie')||request.headers.has('authorization')||
  request.headers.get('x-approval-client')!=='kakeibo-recurring-policy'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return fail('backend_only')
 const stamp=request.headers.get('x-approval-timestamp')||'',
  signature=request.headers.get('x-approval-signature')||''
 if(!/^\d{13}$/.test(stamp)||Math.abs(nowMs()-Number(stamp))>300000||
  !hex.test(signature))return fail('invalid_signature')
 let b,raw
 try{raw=await request.text();b=raw.length<=1450?JSON.parse(raw):null}catch{return fail('invalid_body',400)}
 if(!exact(b,fields)||!id.test(b.plan_resource_id)||!hex.test(b.plan_payload_sha256)||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128||
  !['fixed_cost','sbi_tsumitate'].includes(b.plan_type)||
  !Number.isSafeInteger(b.source_account_version)||b.source_account_version<1||
  !Number.isSafeInteger(b.due_day)||b.due_day<1||b.due_day>28||
  !Number.isSafeInteger(b.max_amount_jpy)||b.max_amount_jpy<1||b.max_amount_jpy>10000000||
  typeof b.start_month!=='string'||typeof b.end_month!=='string')
  return fail('invalid_plan_terms',400)
 const expected=await sign(e.RECURRING_FINANCE_POLICY_SUBMISSION_SECRET,stamp,raw)
 if(!constantEqualHex(expected,signature.toLowerCase()))return fail('invalid_signature')
 const body={expected_user_id:b.requester_user_id,
  plan_resource_id:b.plan_resource_id,plan_payload_sha256:b.plan_payload_sha256,
  plan_type:b.plan_type,source_account_version:b.source_account_version,
  due_day:b.due_day,max_amount_jpy:b.max_amount_jpy,
  start_month:b.start_month,end_month:b.end_month,
  idempotency_key:'recurring-plan:'+b.plan_resource_id}
 const url=new URL('/api/recurring-finance/policies',request.url)
 const res=await recurringFinancePoliciesRoute(new Request(url,{method:'POST',
  headers:{'content-type':'application/json',origin:url.origin},
  body:JSON.stringify(body)}),e,url.pathname,
  {user_id:b.requester_user_id,household_id:b.household_id})
 if(![200,201].includes(res.status))return res
 const data=await res.json(),p=data?.policy
 if(data?.ok!==true||p?.plan_resource_id!==b.plan_resource_id||
  p?.plan_payload_sha256!==b.plan_payload_sha256||
  p?.member_user_id!==b.requester_user_id||p?.household_id!==b.household_id||
  p?.plan_type!==b.plan_type||p?.source_account_version!==b.source_account_version||
  p?.due_day!==b.due_day||p?.max_amount_jpy!==b.max_amount_jpy||
  p?.start_month!==b.start_month||p?.end_month!==b.end_month||
  p?.ledger_applied!==false)
  return fail('recurring_policy_receipt_mismatch',503)
 return json({ok:true,policy:p,replayed:data.replayed===true,
  owner_approved:p.status==='approved',ledger_applied:false,
  plan_resource_id:p.plan_resource_id,plan_payload_sha256:p.plan_payload_sha256,
  requester_user_id:p.member_user_id,household_id:p.household_id},res.status)
}
