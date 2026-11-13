import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('external installed PWA can land on /authorize while existing HomeFlow login remains usable',()=>{
 const app=read('src/App.vue')
 assert.match(app,/oauthLanding=window.location.pathname==='\/authorize'/)
 assert.match(app,/<OAuthConsent v-if="oauthLanding&&authReady&&user&&!authFailure"/)
 assert.match(app,/v-else-if="!user" class="auth-content"/)
 assert.match(app,/@submit.prevent="submitAuth"/)
})

test('OAuth consent requires a real click and does not auto-redirect or cache tokens',()=>{
 const ui=read('src/components/OAuthConsent.vue')
 assert.match(ui,/@click="approve"/)
 assert.match(ui,/consent:true/)
 assert.match(ui,/method:'POST',credentials:'same-origin'/)
 assert.match(ui,/window.location.assign\(data.redirect_uri\)/)
 assert.match(ui,/window.location.assign\('\/'\)/)
 assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB|document.cookie/)
 assert.doesNotMatch(ui,/AUTH_PASSWORD|AUTH_TOKEN|client_secret/)
})

test('HomeFlow API token endpoint is backend-only and account scope is server verified',()=>{
 const router=read('worker/index.js')
 const oauth=read('worker/oauth.js')
 assert.ok(router.includes("path!=='/api/oauth/token'"))
 assert.match(router,/path.startsWith\('\/api\/oauth\/'\)/)
 assert.match(oauth,/request.headers.has\('origin'\)/)
 assert.match(oauth,/redirectAllowed\(env,client_id,redirect_uri\)/)
 assert.match(oauth,/WHERE m.user_id=\?1 AND m.household_id=\?2 AND u.disabled_at IS NULL/)
 assert.match(oauth,/a.expires_at>\?2 AND a.revoked_at IS NULL/)
})
