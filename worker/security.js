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
// Require the latest deployed business schema without rejecting compatible future migrations.
export async function verifiedDatabase(env) {
  const expected=env.APP_ENV==='production'?'homeflow':env.APP_ENV==='preview'?'homeflow-preview':null
  if (!expected || !env.DB?.prepare) return false
  const now=Date.now(),cached=dbIdentityCache.get(env.DB)
  if(cached?.name===expected && cached.expiresAt>now)return true
  try {
    const identity=await env.DB.prepare(`SELECT database_name,
      (SELECT COUNT(*) FROM d1_migrations
       WHERE name='0041_dual_assignees.sql') AS required_migration_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
       AND name='idx_today_actions_original') AS action_index_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
       AND name='household_revisions') AS sync_table_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
       AND name='member_revisions') AS member_sync_ready,
      (SELECT COUNT(*) FROM pragma_table_info('notification_inbox')
       WHERE name='last_completion_key') AS completion_read_ready,
      (SELECT COUNT(*) FROM pragma_table_info('goal_period_settlements')
       WHERE name='settlement_origin') AS settlement_origin_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
       AND name='routine_occurrence_assignments') AS routine_assignments_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
       AND name='idx_routine_assignment_due') AS routine_assignment_index_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='view'
       AND name='dual_completion_splits') AS joint_credits_ready,
      (SELECT COUNT(*) FROM pragma_table_info('tasks')
       WHERE name='second_assignee_user_id') AS second_assignee_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='view'
       AND name='monthly_achievement_credits') AS achievement_credits_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='monthly_achievement_awards') AS monthly_awards_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'monthly_achievement_%') AS monthly_triggers_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='goal_completion_rewards') AS savings_rewards_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN
        ('points_goal_met','points_goal_reopened','points_goal_hidden','points_goal_restored')) AS savings_triggers_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
       AND name='completion_points') AS points_table_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN
       ('points_task_completed','points_task_reopened','points_task_visibility',
        'points_task_permanent_delete','points_routine_completed_insert',
        'points_routine_completed_update','points_routine_reopened',
        'points_routine_mark_deleted','points_routine_visibility',
        'points_routine_permanent_delete')) AS points_triggers_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN
       ('reward_items','reward_redemptions','weekly_challenge_awards',
        'reward_group_orders','reward_group_contributions')) AS rewards_tables_ready,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN
       ('rewards_weekly_points_earned','rewards_weekly_points_revoked',
        'rewards_seed_new_household','rewards_group_funded')) AS rewards_triggers_ready
      FROM environment_identity WHERE key='current' LIMIT 1`).first()
    const valid=identity?.database_name===expected &&
      Number(identity.required_migration_ready)===1 &&
      Number(identity.action_index_ready)===1 &&
      Number(identity.sync_table_ready)===1 &&
      Number(identity.member_sync_ready)===1 &&
      Number(identity.completion_read_ready)===1 &&
      Number(identity.settlement_origin_ready)===1 &&
      Number(identity.routine_assignments_ready)===1 &&
      Number(identity.routine_assignment_index_ready)===1 &&
      Number(identity.joint_credits_ready)===1 &&
      Number(identity.second_assignee_ready)===1 &&
      Number(identity.achievement_credits_ready)===1 &&
      Number(identity.monthly_awards_ready)===1 &&
      Number(identity.monthly_triggers_ready)===5 &&
      Number(identity.savings_rewards_ready)===1 &&
      Number(identity.savings_triggers_ready)===4 &&
      Number(identity.points_table_ready)===1 &&
      Number(identity.points_triggers_ready)===10 &&
      Number(identity.rewards_tables_ready)===5 &&
      Number(identity.rewards_triggers_ready)===4
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
