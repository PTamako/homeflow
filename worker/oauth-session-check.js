import {json,sha256,nowMs} from './security.js'

// Read-only, backend-only liveness check for a 15-minute opaque assertion.
// Always join the ORIGINAL HomeFlow login session so logout, disabling the
// account, or removing household membership invalidates the linked app now.
// The proof does not grant access to HomeFlow or any business App data.
export async function oauthSessionCheck(request,env){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  if(env.OAUTH_ENABLED!=='true')return json({error:'oauth_disabled'},503)
  if(request.headers.has('origin'))return json({error:'backend_only'},403)
  const type=(request.headers.get('content-type')||'').toLowerCase()
  if(!type.startsWith('application/x-www-form-urlencoded'))
    return json({error:'invalid_assertion'},401)
  const raw=await request.text()
  if(raw.length>1024)return json({error:'invalid_assertion'},401)
  const params=new URLSearchParams(raw)
  if(params.getAll('client_id').length!==1||
    params.getAll('session_assertion').length!==1||
    [...params.keys()].some(k=>k!=='client_id'&&k!=='session_assertion'))
    return json({error:'invalid_assertion'},401)
  const client=params.get('client_id'),value=params.get('session_assertion')
  if(typeof client!=='string'||!/^[a-z][a-z0-9-]{2,48}$/.test(client)||
     typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))
    return json({error:'invalid_assertion'},401)
  // One indexed read, no write audit or polling: avoid additional D1 quota
  // consumption on background timers. Clients call on authorization checks.
  const sql=[
   'SELECT a.user_id,a.household_id,a.client_id,m.role,u.login_name,',
   'COALESCE(NULLIF((SELECT f.display_name FROM family_profiles f',
   'WHERE f.household_id=m.household_id AND f.member_user_id=m.user_id',
   "AND f.type='person' AND f.archived_at IS NULL",
   'ORDER BY f.created_at,f.id LIMIT 1),',
   "''),u.login_name) AS nickname",
   'FROM oauth_session_assertions a',
   'JOIN users u ON u.id=a.user_id AND u.disabled_at IS NULL',
   'JOIN household_members m ON m.user_id=a.user_id AND m.household_id=a.household_id',
   'JOIN sessions h ON h.token_hash=a.session_hash AND h.user_id=a.user_id',
   'AND h.expires_at>?2',
   'WHERE a.assertion_hash=?1 AND a.client_id=?3',
   'AND a.expires_at>?2 AND a.revoked_at IS NULL LIMIT 1'
  ].join(' ')
  const row=await env.DB.prepare(sql).bind(await sha256(value),nowMs(),client).first()
  if(!row)return json({error:'invalid_assertion'},401)
  return json({active:true,sub:row.user_id,user_id:row.user_id,
   household_id:row.household_id,role:row.role,nickname:row.nickname,
   audience:row.client_id})
}
