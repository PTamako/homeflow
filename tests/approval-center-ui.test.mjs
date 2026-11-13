import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('member can withdraw only own pending approval using the existing server cancel endpoint', () => {
 const view = read('../src/components/ApprovalCenter.vue')
 assert.match(view, /item\.requester_user_id===props\.userId&&item\.status==='pending'/)
 assert.match(view, /!isOwner&&item\.requester_user_id===userId&&item\.status==='pending'/)
 assert.match(view, /kind==='cancel'\?'\/api\/approvals\/'.*?'\/cancel'/s)
 assert.match(view, /@click="act\(item,'cancel'\)"/)
 assert.match(view, /await confirmAction\(options\)/)
 assert.match(view, /account!==props\.userId\|\|!props\.active/)
 assert.match(view, /cancelConfirm\(\)/)
})

test('approval requester is labeled by HomeFlow family profile, never by guessed nickname ownership', () => {
 const view = read('../src/components/ApprovalCenter.vue')
 const manage = read('../src/components/ManagePage.vue')
 const app = read('../src/App.vue')
 assert.match(view, /props\.profiles\?\.find\(p=>p\.memberUserId===id\)\?\.displayName/)
 assert.match(manage, /:profiles="profiles"/)
 assert.match(app, /:members="members" :profiles="profiles"/)
})
