import {
  cookieFrom, cookieValue, constantEqualHex, eraseCookie, hashPassword,
  isValidLogin, iso, json, nowMs, passwordMatches, randomToken,
  readBody, sessionFor, sha256, shortText, validPassword,
} from './security.js'

const MAX_SESSIONS_MS=14*86400000
const ALLOWED_BOOTSTRAP_NAME=/^[\p{L}\p{N} ._-]{1,60}$/u

const createSession=async(db, userId) => {
  const token=randomToken()
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?1,?2,?3)')
    .bind(await sha256(token),userId,nowMs()+MAX_SESSIONS_MS).run()
  return cookieValue(token)
}
const malformed=()=>json({error:'invalid_input'},400)
const conflict=()=>json({error:'conflict_or_expired'},409)

async function credentials(db, body, opts={}) {
  const login=String(body?.loginName||'').trim().toLowerCase()
  const password=body?.password
  if(!isValidLogin(login) || !validPassword(password)) return null
  const exists=await db.prepare('SELECT id FROM users WHERE login_name=?1').bind(login).first()
  if(exists) return null
  const name=shortText(body?.displayName,60)
  if(!name || !ALLOWED_BOOTSTRAP_NAME.test(name)) return null
  const cryptoPassword=await hashPassword(password)
  return {login,name,...cryptoPassword,id:crypto.randomUUID(),...opts}
}
async function limiter(db, login, request) {
  const ip=request.headers.get('CF-Connecting-IP')||'unknown'
  const key=await sha256('login|'+login+'|'+ip)
  const t=nowMs()
  const row=await db.prepare('SELECT failures,window_ends,blocked_until FROM login_limits WHERE key=?1').bind(key).first()
  return {key,blocked: !!(row && row.blocked_until > t)}
}
async function recordFailure(db,key) {
  const time=nowMs(), end=time+15*60000
  await db.prepare(`INSERT INTO login_limits(key,failures,window_ends,blocked_until)
    VALUES(?1,1,?2,0) ON CONFLICT(key) DO UPDATE SET
    failures=CASE WHEN login_limits.window_ends <= ?3 THEN 1 ELSE login_limits.failures+1 END,
    window_ends=CASE WHEN login_limits.window_ends <= ?3 THEN ?2 ELSE login_limits.window_ends END,
    blocked_until=CASE WHEN login_limits.window_ends > ?3 AND login_limits.failures >= 4
      THEN ?3+900000 ELSE login_limits.blocked_until END`)
    .bind(key,end,time).run()
}
export async function authRoute(request,env,path,session) {
  const db=env.DB
  if(path==='/api/auth/me' && request.method==='GET') {
    if(!session) return json({error:'not_authenticated'},401)
    return json({user:{id:session.user_id,loginName:session.login_name,role:session.role,
      householdId:session.household_id,householdName:session.household_name}})
  }
  if(path==='/api/auth/bootstrap-status' && request.method==='GET') {
    const row=await db.prepare('SELECT 1 AS found FROM households LIMIT 1').first()
    return json({initialized:!!row,bootstrapAvailable:!row && !!env.HOMEFLOW_BOOTSTRAP_SECRET})
  }
  if(path==='/api/auth/bootstrap' && request.method==='POST') {
    const body=await readBody(request)
    if(!body) return malformed()
    if(typeof env.HOMEFLOW_BOOTSTRAP_SECRET!=='string'||env.HOMEFLOW_BOOTSTRAP_SECRET.length<32)
      return json({error:'bootstrap_not_configured'},503)
    if(typeof body.bootstrapSecret!=='string'||body.bootstrapSecret.length>512)
      return json({error:'bootstrap_not_authorized'},403)
    // Both values are hashed first, then compared without early-exit.
    const [sent,expected]=await Promise.all([sha256(body.bootstrapSecret),sha256(env.HOMEFLOW_BOOTSTRAP_SECRET)])
    if(!constantEqualHex(sent,expected)) return json({error:'bootstrap_not_authorized'},403)
    const account=await credentials(db,body)
    if(!account) return malformed()
    const householdId='primary'
    const householdName=shortText(body.householdName,60)||'我们的小家'
    try {
      await db.batch([
        db.prepare(`INSERT INTO households(id,display_name,timezone)
          SELECT 'primary',?1,'Asia/Tokyo' WHERE NOT EXISTS(SELECT 1 FROM households)`).bind(householdName),
        db.prepare(`INSERT INTO users(id,login_name,password_salt,password_verifier,password_rounds)
          SELECT ?1,?2,?3,?4,?5
          WHERE EXISTS(SELECT 1 FROM households WHERE id='primary')
            AND NOT EXISTS(SELECT 1 FROM household_members)`)
          .bind(account.id,account.login,account.salt,account.verifier,account.rounds),
        db.prepare(`INSERT INTO household_members(household_id,user_id,role)
          SELECT 'primary',?1,'owner'
          WHERE EXISTS(SELECT 1 FROM users WHERE id=?1)
            AND NOT EXISTS(SELECT 1 FROM household_members)`).bind(account.id),
        db.prepare(`INSERT INTO family_profiles(id,household_id,member_user_id,type,display_name,relation)
          SELECT ?1,'primary',?2,'person',?3,'self'
          WHERE EXISTS(SELECT 1 FROM household_members WHERE user_id=?2)`)
          .bind(crypto.randomUUID(),account.id,account.name)
      ])
      const owned=await db.prepare("SELECT 1 AS found FROM household_members WHERE user_id=?1 AND role='owner'").bind(account.id).first()
      if(!owned) return conflict()
      return json({ok:true,role:'owner'},201,{'set-cookie':await createSession(db,account.id)})
    } catch {
      return conflict()
    }
  }
  if(path==='/api/auth/login' && request.method==='POST') {
    const body=await readBody(request)
    const login=String(body?.loginName||'').trim().toLowerCase()
    const password=body?.password
    if(!isValidLogin(login)||!validPassword(password))return malformed()
    const {key,blocked}=await limiter(db,login,request)
    if(blocked)return json({error:'too_many_attempts'},429)
    const user=await db.prepare(`SELECT id,login_name,password_salt,password_verifier,password_rounds
       FROM users WHERE login_name=?1 AND disabled_at IS NULL`).bind(login).first()
    const valid=user ? await passwordMatches(password,user) : false
    if(!valid){
      await recordFailure(db,key)
      return json({error:'invalid_credentials'},401)
    }
    await db.prepare('DELETE FROM login_limits WHERE key=?1').bind(key).run()
    return json({ok:true},200,{'set-cookie':await createSession(db,user.id)})
  }
  if(path==='/api/auth/logout' && request.method==='POST') {
    const token=cookieFrom(request)
    if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?1').bind(await sha256(token)).run()
    return json({ok:true},200,{'set-cookie':eraseCookie()})
  }
  if(path==='/api/auth/invitations' && request.method==='POST') {
    if(!session)return json({error:'not_authenticated'},401)
    if(session.role!=='owner')return json({error:'forbidden'},403)
    const members=await db.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id=?1').bind(session.household_id).first()
    if(Number(members?.count)>=2)return json({error:'household_full'},409)
    const token=randomToken()
    await db.prepare(`INSERT INTO invitations(token_hash,household_id,issued_by,expires_at)
      VALUES(?1,?2,?3,?4)`).bind(await sha256(token),session.household_id,session.user_id,nowMs()+7*86400000).run()
    return json({invitationCode:token,expiresInDays:7},201)
  }
  if(path==='/api/auth/join' && request.method==='POST') {
    const body=await readBody(request)
    if(!body || typeof body.invitationCode!=='string' || !/^[a-f0-9]{64}$/.test(body.invitationCode))
      return malformed()
    const account=await credentials(db,body)
    if(!account)return malformed()
    const hashed=await sha256(body.invitationCode)
    const invite=await db.prepare(`SELECT household_id FROM invitations WHERE token_hash=?1
      AND used_at IS NULL AND expires_at>?2`).bind(hashed,nowMs()).first()
    if(!invite)return conflict()
    try {
      // Transactional conditional INSERTs; token is also marked redeemed exactly once.
      await db.batch([
        db.prepare(`INSERT INTO users(id,login_name,password_salt,password_verifier,password_rounds)
          SELECT ?1,?2,?3,?4,?5 FROM invitations i WHERE i.token_hash=?6
          AND i.used_at IS NULL AND i.expires_at>?7 AND
          (SELECT COUNT(*) FROM household_members WHERE household_id=i.household_id)<2`)
          .bind(account.id,account.login,account.salt,account.verifier,account.rounds,hashed,nowMs()),
        db.prepare(`INSERT INTO invitation_redemptions(token_hash,user_id)
          SELECT ?1,?2 FROM users WHERE id=?2`).bind(hashed,account.id),
        db.prepare(`INSERT INTO household_members(household_id,user_id,role)
          SELECT ?1,?2,'member' WHERE EXISTS
          (SELECT 1 FROM invitation_redemptions WHERE token_hash=?3 AND user_id=?2)`)
          .bind(invite.household_id,account.id,hashed),
        db.prepare(`INSERT INTO family_profiles(id,household_id,member_user_id,type,display_name,relation)
          SELECT ?1,?2,?3,'person',?4,'family' WHERE EXISTS
          (SELECT 1 FROM household_members WHERE user_id=?3)`)
          .bind(crypto.randomUUID(),invite.household_id,account.id,account.name),
        db.prepare(`UPDATE invitations SET used_at=?2,used_by=?3 WHERE token_hash=?1
          AND used_at IS NULL AND EXISTS
          (SELECT 1 FROM household_members WHERE user_id=?3)`)
          .bind(hashed,iso(),account.id)
      ])
      const member=await db.prepare('SELECT 1 AS found FROM household_members WHERE user_id=?1').bind(account.id).first()
      if(!member)return conflict()
      return json({ok:true,role:'member'},201,{'set-cookie':await createSession(db,account.id)})
    }catch{return conflict()}
  }
  return json({error:'not_found'},404)
}
