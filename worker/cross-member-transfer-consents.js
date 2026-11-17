// DRAFT P0-4C: two independent household identities explicitly consent to an
// opaque future Kakeibo transfer, then HomeFlow owner separately authorizes.
// This is NOT a ledger executor / proof endpoint. Nothing here moves money.
import {json,nowMs,sameOrigin,sha256} from './security.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex32=/^[a-f0-9]{32}$/;
const hex64=/^[a-f0-9]{64}$/;
const idempotency=/^[a-zA-Z0-9._:-]{12,128}$/;
const err=(code,status=409)=>json({ok:false,code,ledger_applied:false},status);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const on=env=>env.APP_ENV==='production'&&env.APPROVALS_ENABLED==='true'&&
 env.CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED==='true'&&!!env.DB?.prepare;
async function parse(request){
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 try{
  const raw=await request.text();
  if(raw.length>1350)return null;
  const body=JSON.parse(raw);
  return body&&typeof body==='object'&&!Array.isArray(body)?body:null;
 }catch{return null;}
}
async function activeRole(db,household,userId){
 const result=await db.prepare('SELECT m.role FROM household_members m '+
  'JOIN users u ON u.id=m.user_id WHERE m.household_id=? AND m.user_id=? '+
  'AND u.disabled_at IS NULL LIMIT 1').bind(household,userId).first();
 return ['owner','member'].includes(result?.role)?result.role:null;
}
async function read(db,session,id){
 return db.prepare('SELECT * FROM household_cross_member_transfer_consents '+
  'WHERE consent_id=? AND household_id=? AND '+
  '(source_user_id=? OR recipient_user_id=?) LIMIT 1')
  .bind(id,session.household_id,session.user_id,session.user_id).first();
}
const expose=(row)=>({
 consent_id:row.consent_id,
 resource_id:row.resource_id,
 payload_sha256:row.payload_sha256,
 household_id:row.household_id,
 source_user_id:row.source_user_id,
 recipient_user_id:row.recipient_user_id,
 source_account_version:row.source_account_version,
 recipient_account_version:row.recipient_account_version,
 status:row.status,
 source_confirmed:true,
 recipient_confirmed:row.recipient_decided_at!=null&&row.status!=='recipient_rejected'&&row.status!=='cancelled',
 recipient_decided_at:row.recipient_decided_at,
 owner_authorizer_user_id:row.owner_authorizer_user_id,
 owner_authorized_at:row.owner_authorized_at,
 expires_at:row.expires_at,
 version:row.version,
 ledger_applied:false,
 execution_permitted:false,
 requires_target_account_owner_and_bank_proof:true
});
function matches(row,session,x,idemHash){
 return !!row&&row.household_id===session.household_id&&row.source_user_id===session.user_id&&
  row.recipient_user_id===x.recipient_user_id&&row.resource_id===x.resource_id&&
  row.payload_sha256===x.payload_sha256&&row.source_account_version===x.source_account_version&&
  row.recipient_account_version===x.recipient_account_version&&row.idempotency_hash===idemHash;
}
async function create(request,env,session,role){
 const x=await parse(request);
 if(!exact(x,['expected_user_id','recipient_user_id','resource_id','payload_sha256',
  'source_account_version','recipient_account_version','source_confirmed','idempotency_key']))
  return err('cross_transfer_invalid_metadata',400);
 if(x.expected_user_id!==session.user_id)return err('cross_transfer_actor_changed',403);
 if(x.source_confirmed!==true||
  typeof x.recipient_user_id!=='string'||!x.recipient_user_id||
  x.recipient_user_id.length>128||x.recipient_user_id===session.user_id||
  !hex32.test(x.resource_id)||!hex64.test(x.payload_sha256)||
  !idempotency.test(x.idempotency_key)||
  !Number.isSafeInteger(x.source_account_version)||x.source_account_version<1||
  !Number.isSafeInteger(x.recipient_account_version)||x.recipient_account_version<1)
  return err('cross_transfer_invalid_metadata',400);
 const otherRole=await activeRole(env.DB,session.household_id,x.recipient_user_id);
 if(!otherRole||!['owner','member'].includes(role))
  return err('cross_transfer_recipient_not_active',403);
 const idemHash=await sha256(['cross-transfer-consent-v1',session.household_id,
  session.user_id,x.idempotency_key].join('\0'));
 const lookup=()=>env.DB.prepare('SELECT * FROM household_cross_member_transfer_consents '+
  'WHERE idempotency_hash=? LIMIT 1').bind(idemHash).first();
 const existing=await lookup();
 if(existing)return matches(existing,session,x,idemHash)?
  json({ok:true,consent:expose(existing),replayed:true}):
  err('cross_transfer_idempotency_conflict');
 const stamp=nowMs(),consentId=crypto.randomUUID();
 try{
  const result=await env.DB.prepare('INSERT INTO household_cross_member_transfer_consents '+
   '(consent_id,household_id,source_user_id,recipient_user_id,resource_id,'+
   'payload_sha256,source_account_version,recipient_account_version,'+
   'idempotency_hash,source_confirmed_at,last_actor_user_id,created_at,updated_at,expires_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(consentId,session.household_id,session.user_id,x.recipient_user_id,
    x.resource_id,x.payload_sha256,x.source_account_version,x.recipient_account_version,
    idemHash,stamp,session.user_id,stamp,stamp,stamp+86400000).run();
  if(result.meta?.changes!==1)return err('cross_transfer_request_not_confirmed',503);
  const row=await read(env.DB,session,consentId);
  return row?json({ok:true,consent:expose(row),replayed:false},201):
   err('cross_transfer_request_not_confirmed',503);
 }catch{
  const race=await lookup().catch(()=>null);
  return matches(race,session,x,idemHash)?
   json({ok:true,consent:expose(race),replayed:true}):
   err('cross_transfer_request_conflict');
 }
}
async function decide(request,env,session,role,id,action){
 const body=await parse(request);
 const expectedKeys=action==='recipient'?
  ['expected_user_id','expected_version','decision']:
  ['expected_user_id','expected_version'];
 if(!exact(body,expectedKeys)||
  body?.expected_user_id!==session.user_id)return err('cross_transfer_actor_changed',403);
 if(!Number.isSafeInteger(body.expected_version)||body.expected_version<1||
  (action==='recipient'&&!['accept','reject'].includes(body.decision)))
  return err('cross_transfer_invalid_decision',400);
 const prior=await read(env.DB,session,id);
 if(!prior)return err('cross_transfer_not_found',404);
 if(prior.version!==body.expected_version)return err('cross_transfer_version_changed');
 const isSource=prior.source_user_id===session.user_id;
 const isRecipient=prior.recipient_user_id===session.user_id;
 if(action==='recipient'&&!isRecipient)return err('cross_transfer_not_recipient',403);
 if(action==='authorize'&&role!=='owner')return err('cross_transfer_owner_required',403);
 if(action==='cancel'&&!isSource)return err('cross_transfer_source_required',403);
 if(action==='revoke'&&!(isSource||isRecipient||(role==='owner'&&
  prior.owner_authorizer_user_id===session.user_id)))
  return err('cross_transfer_revoke_denied',403);
 const next=action==='recipient'?
  (body.decision==='accept'?'recipient_accepted':'recipient_rejected'):
  action==='authorize'?'owner_authorized':
  action==='cancel'?'cancelled':'revoked';
 const prev=action==='recipient'?'awaiting_recipient':
  action==='authorize'?'recipient_accepted':
  action==='cancel'?prior.status:'owner_authorized';
 if(action==='cancel'&&!['awaiting_recipient','recipient_accepted'].includes(prior.status))
  return err('cross_transfer_cannot_cancel',409);
 if(prior.status!==prev)return err('cross_transfer_not_in_expected_state');
 // When the recipient IS the owner, their single explicit receipt consent
 // also records the separate owner authorization atomically. The original
 // immutable two-event audit and the three-version signed proof remain intact.
 // This does not approve or post any family ledger entry.
 const ownerRecipient=action==='recipient'&&body.decision==='accept'&&
  isRecipient&&role==='owner'&&
  env.CROSS_MEMBER_RECIPIENT_AUTO_AUTHORIZE_ENABLED==='true';
 if(ownerRecipient){
  const firstAt=nowMs(),secondAt=firstAt+1;
  if(secondAt>=prior.expires_at)return err('cross_transfer_consent_expired');
  if(typeof env.DB.batch!=='function')return err('cross_transfer_atomic_batch_unavailable',503);
  try{
   const updates=await env.DB.batch([
    env.DB.prepare(
     "UPDATE household_cross_member_transfer_consents SET status='recipient_accepted',"+
     'last_actor_user_id=?,recipient_decided_at=?,version=version+1,updated_at=? '+
     "WHERE consent_id=? AND household_id=? AND recipient_user_id=? AND status='awaiting_recipient' "+
     'AND version=? AND expires_at>?')
     .bind(session.user_id,firstAt,firstAt,id,session.household_id,
      session.user_id,body.expected_version,firstAt),
    env.DB.prepare(
     "UPDATE household_cross_member_transfer_consents SET status='owner_authorized',"+
     'last_actor_user_id=?,owner_authorizer_user_id=?,owner_authorized_at=?,version=version+1,updated_at=? '+
     "WHERE consent_id=? AND household_id=? AND recipient_user_id=? AND status='recipient_accepted' "+
     'AND version=? AND expires_at>? AND changes()=1')
     .bind(session.user_id,session.user_id,secondAt,secondAt,id,
      session.household_id,session.user_id,body.expected_version+1,secondAt)
   ]);
   if(updates?.length!==2||updates.some(r=>r?.meta?.changes!==1))
    return err('cross_transfer_atomic_consent_unconfirmed',503);
   const confirmed=await read(env.DB,session,id);
   return confirmed?.status==='owner_authorized'&&
    confirmed.version===body.expected_version+2&&
    confirmed.owner_authorizer_user_id===session.user_id?
    json({ok:true,consent:expose(confirmed),replayed:false}):
    err('cross_transfer_atomic_consent_unconfirmed',503);
  }catch{return err('cross_transfer_consent_conflict');}
 }
 const stamp=nowMs();
 if(['recipient','authorize'].includes(action)&&stamp>=prior.expires_at)
  return err('cross_transfer_consent_expired');
 try{
  const changed=await env.DB.prepare(
   'UPDATE household_cross_member_transfer_consents SET status=?,last_actor_user_id=?,'+
   'recipient_decided_at=CASE WHEN ?=1 THEN ? ELSE recipient_decided_at END,'+
   'owner_authorized_at=CASE WHEN ?=1 THEN ? ELSE owner_authorized_at END,'+
   'owner_authorizer_user_id=CASE WHEN ?=1 THEN ? ELSE owner_authorizer_user_id END,'+
   'version=version+1,updated_at=? '+
   'WHERE consent_id=? AND household_id=? AND version=? AND status=? '+
   'AND (?=0 OR expires_at>?)')
   .bind(next,session.user_id,action==='recipient'?1:0,stamp,
    action==='authorize'?1:0,stamp,action==='authorize'?1:0,
    session.user_id,stamp,id,session.household_id,body.expected_version,prev,
    ['recipient','authorize'].includes(action)?1:0,stamp).run();
  if(changed.meta?.changes!==1)return err('cross_transfer_consent_conflict');
  const row=await read(env.DB,session,id);
  return row?json({ok:true,consent:expose(row),replayed:false}):
   err('cross_transfer_consent_unconfirmed',503);
 }catch{return err('cross_transfer_consent_conflict');}
}
export async function crossMemberTransferConsentsRoute(request,env,path,session){
 if(!on(env))return err('cross_transfer_consents_disabled',503);
 if(!session?.user_id||!session.household_id)return err('not_authenticated',401);
 const role=await activeRole(env.DB,session.household_id,session.user_id);
 if(!role)return err('cross_transfer_identity_not_active',403);
 const root='/api/finance-cross-member/consents';
 if(request.method==='GET'){
  if(path===root){
   const results=await env.DB.prepare('SELECT * FROM household_cross_member_transfer_consents '+
    'WHERE household_id=? AND (source_user_id=? OR recipient_user_id=?) '+
    'ORDER BY created_at DESC,consent_id DESC LIMIT 30')
    .bind(session.household_id,session.user_id,session.user_id).all();
   return json({ok:true,items:(results.results||[]).map(expose),ledger_applied:false});
  }
  const match=new RegExp('^'+root+'/([a-f0-9-]{36})$','i').exec(path);
  if(!match||!uuid.test(match[1]))return err('not_found',404);
  const row=await read(env.DB,session,match[1]);
  return row?json({ok:true,consent:expose(row)}):err('not_found',404);
 }
 if(request.method!=='POST'||!sameOrigin(request))
  return err('cross_transfer_method_or_origin_denied',403);
 if(path===root)return create(request,env,session,role);
 const match=new RegExp('^'+root+'/([a-f0-9-]{36})/(recipient|authorize|cancel|revoke)$','i').exec(path);
 if(!match||!uuid.test(match[1]))return err('not_found',404);
 return decide(request,env,session,role,match[1],match[2]);
}
