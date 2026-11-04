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
export const PASSWORD_ROUNDS = 160000
export async function hashPassword(password, salt = randomToken().slice(0,32), rounds = PASSWORD_ROUNDS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:rounds}, key, 256)
  return { salt, rounds, verifier: Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('') }
}
export async function passwordMatches(password, user) {
  const rounds = Number(user.password_rounds) || PASSWORD_ROUNDS
  if (rounds < 100000 || rounds > 600000) return false
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
export async function verifiedDatabase(env) {
  const expected=env.APP_ENV==='production'?'homeflow':env.APP_ENV==='preview'?'homeflow-preview':null
  if (!expected || !env.DB?.prepare) return false
  try {
    const identity=await env.DB.prepare("SELECT database_name FROM environment_identity WHERE key='current' LIMIT 1").first()
    return identity?.database_name===expected
  }catch{return false}
}
export function isValidLogin(login) {
  return /^[a-zA-Z0-9._-]{3,36}$/.test(login)
}
export const iso = () => new Date().toISOString()
