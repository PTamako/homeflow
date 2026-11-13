import {json,randomToken,sha256,readBody,nowMs} from './security.js'

// B2: Authorization Code + PKCE transport foundation. It is not yet an
// end-to-end login UI or an OpenID Connect ID-token implementation.
// Opt-in only: production without OAUTH_ENABLED='true' always fails closed.
const CODE_TTL_MS = 3 * 60_000
const ACCESS_TTL_MS = 3 * 60_000
const CLIENT_ID = /^[a-z][a-z0-9-]{2,48}$/
const B64URL = /^[A-Za-z0-9_-]{43}$/
const STATE = /^[A-Za-z0-9._~:-]{16,256}$/
const validNonce = value => typeof value==='string' && value.length>=16 && value.length<=256
const encoder = new TextEncoder()

function redirectAllowed(env,clientId,redirectUri){
  if(!CLIENT_ID.test(clientId) || typeof redirectUri!=='string' || redirectUri.length>512) return false
  let urls,parsed
  try{
    if(typeof env.OAUTH_CLIENT_REDIRECTS!=='string' || env.OAUTH_CLIENT_REDIRECTS.length>4096) return false
    urls=JSON.parse(env.OAUTH_CLIENT_REDIRECTS)
    parsed=new URL(redirectUri)
  }catch{return false}
  if(!urls || Array.isArray(urls) || typeof urls!=='object')return false
  const allowed=urls[clientId]
  return Array.isArray(allowed) && allowed.length>0 && allowed.length<=5 &&
    parsed.protocol==='https:' && !parsed.username && !parsed.password &&
    !parsed.hash && allowed.some(uri=>typeof uri==='string' && uri===redirectUri)
}
function digestB64url(value){
  return crypto.subtle.digest('SHA-256',encoder.encode(value)).then(buf=>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'))
}
async function tokenBody(request){
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))
    return null
  const source=await request.text()
  if(source.length>4096)return null
  const params=new URLSearchParams(source)
  const keys=['grant_type','client_id','redirect_uri','code','code_verifier']
  if([...params.keys()].some(k=>!keys.includes(k)))return null
  if(keys.some(k=>params.getAll(k).length!==1))return null
  return Object.fromEntries(keys.map(k=>[k,params.get(k)]))
}
function routeReady(env){
  return env.OAUTH_ENABLED==='true' && Boolean(env.DB?.prepare)
}
function noStore(response){
  const headers=new Headers(response.headers)
  headers.set('pragma','no-cache')
  return new Response(response.body,{status:response.status,headers})
}

export async function oauthRoute(request,env,path,session){
  if(!routeReady(env))return json({error:'oauth_disabled'},503)
  const db=env.DB
  if(path==='/api/oauth/authorize'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    if(!session?.user_id || !session?.household_id)return json({error:'not_authenticated'},401)
    const data=await readBody(request)
    const client_id=data?.client_id,redirect_uri=data?.redirect_uri
    if(data?.response_type!=='code' || data?.code_challenge_method!=='S256' ||
      typeof client_id!=='string'||!redirectAllowed(env,client_id,redirect_uri) ||
      typeof data?.code_challenge!=='string' || !B64URL.test(data.code_challenge) ||
      typeof data?.state!=='string'||!STATE.test(data.state)||
      !validNonce(data?.nonce) || data?.consent!==true)
      return json({error:'invalid_authorization_request'},400)
    // A signed-in user may have been disabled or removed since the session
    // was minted; recheck on every approval, not on every normal GET.
    const membership=await db.prepare(`SELECT m.role FROM household_members m
      JOIN users u ON u.id=m.user_id
      WHERE m.user_id=?1 AND m.household_id=?2 AND u.disabled_at IS NULL
      LIMIT 1`).bind(session.user_id,session.household_id).first()
    if(!membership)return json({error:'not_authorized'},403)
    const raw=randomToken(),t=nowMs()
    await db.prepare(`INSERT INTO oauth_authorization_codes
       (code_hash,client_id,redirect_uri,user_id,household_id,
        code_challenge,nonce,expires_at,created_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
      .bind(await sha256(raw),client_id,redirect_uri,session.user_id,
        session.household_id,data.code_challenge,data.nonce,t+CODE_TTL_MS,t).run()
    const redirect=new URL(redirect_uri)
    redirect.searchParams.set('code',raw)
    redirect.searchParams.set('state',data.state)
    return noStore(json({redirect_uri:redirect.toString(),expires_in:CODE_TTL_MS/1000}))
  }
  if(path==='/api/oauth/token'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    // No third-party browser CORS/Origin access; backchannel only. CSRF is
    // prevented by PKCE + one-use code + registered redirect URI.
    if(request.headers.has('origin'))return json({error:'backend_only'},403)
    const data=await tokenBody(request)
    if(!data || data.grant_type!=='authorization_code' ||
       !redirectAllowed(env,data.client_id,data.redirect_uri) ||
       typeof data.code!=='string'||!/^[a-f0-9]{64}$/.test(data.code) ||
       typeof data.code_verifier!=='string' ||
       !/^[A-Za-z0-9._~-]{43,128}$/.test(data.code_verifier))
      return json({error:'invalid_grant'},400)
    const hash=await sha256(data.code),t=nowMs()
    const existing=await db.prepare(`SELECT client_id,redirect_uri,code_challenge,
      expires_at,consumed_at FROM oauth_authorization_codes
      WHERE code_hash=?1 LIMIT 1`).bind(hash).first()
    if(!existing || existing.client_id!==data.client_id ||
       existing.redirect_uri!==data.redirect_uri ||
       Number(existing.expires_at)<=t || existing.consumed_at!=null ||
       await digestB64url(data.code_verifier)!==existing.code_challenge)
      return json({error:'invalid_grant'},400)
    // Unique random consumption marker prevents a concurrent exchange from
    // using the same code even if two requests have the same millisecond.
    const consumedMarker=randomToken(),token=randomToken()
    const dbResults=await db.batch([
      db.prepare(`UPDATE oauth_authorization_codes
        SET consumed_at=?1, consumption_marker=?2 WHERE code_hash=?3
        AND consumed_at IS NULL AND expires_at>?4`)
        .bind(t,consumedMarker,hash,t),
      db.prepare(`INSERT INTO oauth_access_tokens
        (token_hash,client_id,user_id,household_id,expires_at,created_at)
        SELECT ?1,client_id,user_id,household_id,?2,?3
        FROM oauth_authorization_codes
        WHERE code_hash=?4 AND consumption_marker=?5`)
        .bind(await sha256(token),t+ACCESS_TTL_MS,t,hash,consumedMarker)
    ])
    if(Number(dbResults?.[0]?.meta?.changes)!==1 ||
       Number(dbResults?.[1]?.meta?.changes)!==1)
      return json({error:'invalid_grant'},400)
    return noStore(json({access_token:token,token_type:'Bearer',
      expires_in:ACCESS_TTL_MS/1000}))
  }
  if(path==='/api/oauth/userinfo'){
    if(request.method!=='GET')return json({error:'method_not_allowed'},405)
    const header=request.headers.get('authorization')||''
    const match=/^Bearer ([a-f0-9]{64})$/.exec(header)
    if(!match)return json({error:'invalid_token'},401)
    const row=await db.prepare(`SELECT a.user_id,a.household_id,a.client_id,
      m.role,u.login_name,
      COALESCE(NULLIF((
        SELECT f.display_name FROM family_profiles f
        WHERE f.household_id=m.household_id AND f.member_user_id=m.user_id
        AND f.type='person' AND f.archived_at IS NULL
        ORDER BY f.created_at,f.id LIMIT 1
      ),''),u.login_name) AS nickname
      FROM oauth_access_tokens a
      JOIN users u ON u.id=a.user_id AND u.disabled_at IS NULL
      JOIN household_members m ON m.user_id=a.user_id
        AND m.household_id=a.household_id
      WHERE a.token_hash=?1 AND a.expires_at>?2 AND a.revoked_at IS NULL
      LIMIT 1`).bind(await sha256(match[1]),nowMs()).first()
    if(!row)return json({error:'invalid_token'},401)
    return noStore(json({sub:row.user_id,user_id:row.user_id,
      household_id:row.household_id,role:row.role,nickname:row.nickname,
      audience:row.client_id}))
  }
  return json({error:'not_found'},404)
}
