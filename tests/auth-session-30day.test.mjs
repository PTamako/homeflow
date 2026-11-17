import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {cookieValue} from '../worker/security.js'

test('HomeFlow login cookie is bounded to 30 days, not 14',()=>{
 const source=readFileSync(new URL('../worker/auth.js',import.meta.url),'utf8')
 assert.match(source,/const MAX_SESSIONS_MS=30\*86400000/)
 const cookie=cookieValue('a'.repeat(64))
 assert.match(cookie,/__Host-hf_session=[a-f0-9]{64}/)
 assert.match(cookie,/Max-Age=2592000/)
 assert.match(cookie,/HttpOnly/)
 assert.match(cookie,/Secure/)
})

test('A 30-day SSO assertion never bypasses original HomeFlow session or revocation',()=>{
 const oauth=readFileSync(new URL('../worker/oauth.js',import.meta.url),'utf8')
 const check=readFileSync(new URL('../worker/oauth-session-check.js',import.meta.url),'utf8')
 assert.match(oauth,/const SESSION_ASSERTION_TTL_MS = 30 \* 86400000/)
 assert.match(check,/JOIN sessions h ON h\.token_hash=a\.session_hash AND h\.user_id=a\.user_id/)
 assert.match(check,/AND h\.expires_at>\?2/)
 assert.match(check,/AND a\.expires_at>\?2 AND a\.revoked_at IS NULL/)
 assert.match(check,/JOIN users u ON u\.id=a\.user_id AND u\.disabled_at IS NULL/)
})
