export const SESSION_COOKIE = '__Host-hf_session'
const encoder = new TextEncoder()
export const nowMs = () => Date.now()
export const randomToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(b, n => n.toString(16).padStart(2, '0')).join('')
}
export const sha256 = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}
export function constantEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/.test(a+b)) return false
  let different = 0
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return different === 0
}
export const PASSWORD_ROUNDS = 100000
export async function hashPassword(password, salt = randomToken().slice(0,32), rounds = PASSWORD_ROUNDS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:rounds}, key, 256)
  return { salt, rounds, verifier: Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('') }
}
export async function passwordMatches(password, user) {
  const rounds = Number(user.password_rounds) || PASSWORD_ROUNDS
  if (rounds !== 100000) return false
  const candidate = await hashPassword(password, user.password_salt, rounds)
  return constantEqualHex(candidate.verifier, user.password_verifier)
}
export function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128 && encoder.encode(value).length <= 300
}
export function shortText(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0,max + 1) : ''
}
export function validDate(value) {
  if (value === null || value === '') return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const x = new Date(value+'T00:00:00.000Z')
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0,10) === value
}
export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    ...extra
  }
})
export function rejectMethod(request) {
  return json({error:'method_not_allowed'},405,{allow:'GET, POST, PATCH, DELETE'})
}
export async function readBody(request) {
  const length = Number(request.headers.get('content-length')||'0')
  if (length>16000) return null
  const s = await request.text()
  if (s.length>16000) return null
  try { const val=JSON.parse(s); return val && typeof val==='object' && !Array.isArray(val) ? val:null } catch {return null}
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  return !!origin && origin === new URL(request.url).origin &&
    (!site || site === 'same-origin' || site === 'none')
}
export function cookieFrom(request) {
  const found=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-hf_session=([a-f0-9]{64})(?:;|$)/)
  return found?.[1]||null
}
export const cookieValue = token =>
  SESSION_COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600'
export const eraseCookie = () =>
  SESSION_COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'
export async function sessionFor(request, db) {
  const token=cookieFrom(request)
  if (!token) return null
  const hash=await sha256(token)
  return db.prepare(`SELECT u.id AS user_id,u.login_name, m.household_id,m.role,
       h.display_name AS household_name
     FROM sessions s JOIN users u ON u.id=s.user_id
     JOIN household_members m ON m.user_id=u.id
     JOIN households h ON h.id=m.household_id
     WHERE s.token_hash=?1 AND s.expires_at>?2 AND u.disabled_at IS NULL LIMIT 1`)
    .bind(hash,nowMs()).first()
}
// One short-lived cache per physical binding handle: neither secrets nor user data
// are cached. A different binding or environment always forces a new identity read.
const dbIdentityCache=new WeakMap()
const DB_IDENTITY_TTL_MS=15000
const EXPECTED_MIGRATION='0023_today_dismissals.sql'
export async function verifiedDatabase(env) {
  const expected=env.APP_ENV==='production'?'homeflow':env.APP_ENV==='preview'?'homeflow-preview':null
  if (!expected || !env.DB?.prepare) return false
  const now=Date.now(),cached=dbIdentityCache.get(env.DB)
  if(cached?.name===expected && cached.expiresAt>now)return true
  try {
    const identity=await env.DB.prepare(`SELECT database_name,
      (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS latest_migration
      FROM environment_identity WHERE key='current' LIMIT 1`).first()
    const valid=identity?.database_name===expected && identity?.latest_migration===EXPECTED_MIGRATION
    if(valid)dbIdentityCache.set(env.DB,{name:expected,expiresAt:now+DB_IDENTITY_TTL_MS})
    else dbIdentityCache.delete(env.DB)
    return valid
  }catch{dbIdentityCache.delete(env.DB);return false}
}
export function isValidLogin(login) {
  if(typeof login!=='string')return false
  // Keep existing 3–36 character usernames working unchanged.
  if(/^[a-zA-Z0-9._-]{3,36}$/.test(login))return true
  // Also allow an email as a login identifier. This is NOT email ownership verification.
  if(login.length>254||login.length<3)return false
  const parts=login.split('@')
  if(parts.length!==2)return false
  const [local,domain]=parts
  if(!local||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return false
  if(!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local))return false
  if(!domain||domain.length>253||!domain.includes('.'))return false
  const labels=domain.split('.')
  return labels.every(label=>label.length<=63&&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
    &&labels[labels.length-1].length>=2
}
export const iso = () => new Date().toISOString()
