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

test('approval screen updates once when iPhone PWA returns to foreground, without a polling timer', () => {
 const view = read('../src/components/ApprovalCenter.vue')
 assert.match(view, /document\.addEventListener\('visibilitychange',refreshOnReturn\)/)
 assert.match(view, /window\.addEventListener\('pageshow',refreshOnReturn\)/)
 assert.match(view, /document\.removeEventListener\('visibilitychange',refreshOnReturn\)/)
 assert.match(view, /window\.removeEventListener\('pageshow',refreshOnReturn\)/)
 assert.match(view, /available\.value&&expanded\.value/)
 assert.match(view, /!loading\.value&&!busyId\.value\)void load\(true\)/)
 assert.doesNotMatch(view, /setInterval\(/)
})

test('owner can safely retry a failed target execution only with the original approval ID',()=>{
 const view=read('../src/components/ApprovalCenter.vue')
 const server=read('../worker/approval-execution.js')
 // Backend already accepts exactly these two states and never creates a new approval.
 assert.match(server,/\['approved','failed_retryable'\]\.includes\(row\.status\)/)
 assert.match(server,/row\.request_id/)
 assert.match(view,/function canExecute\(item:Approval\)/)
 assert.match(view,/props\.isOwner&&executionEnabled\.value&&/)
 assert.match(view,/item\.status==='approved'\|\|item\.status==='failed_retryable'/)
 assert.match(view,/\?canExecute\(item\):item\.status==='pending'\)/)
 assert.match(view,/v-else-if="canExecute\(item\)"/)
 assert.match(view,/@click="act\(item,'execute'\)"/)
 assert.match(view,/item\.status==='failed_retryable'\?'安全重试':'执行入账'/)
 assert.match(view,/同一审批 ID 与家計簿的幂等记录核对结果/)
 assert.match(view,/上次执行结果未确认；请仅通过原审批安全重试/)
 assert.match(view,/const path=kind==='execute'\?'\/api\/approvals\/'\+id\+'\/execute'/)
 assert.match(view,/if\(item\.status!==chosenStatus/)
 assert.match(view,/if\(account!==props\.userId\|\|!props\.active\)return/)
 // No automatic retries, new approval IDs, or direct financial write route.
 assert.doesNotMatch(view,/setInterval\(|\/api\/family-finance\/entries/)
})


test('unsupported document and non-cash approvals never offer a misleading execute button',()=>{
 const view=read('../src/components/ApprovalCenter.vue')
 const executor=read('../worker/approval-execution.js')
 assert.match(view,/function isSupportedExecution\(item:Approval\)/)
 assert.match(view,/item\.source_app==='kakebo'&&item\.target_app==='kakebo'/)
 assert.match(view,/item\.operation==='finance\.entry\.create'&&item\.resource_type==='finance_entry'/)
 assert.match(view,/props\.isOwner&&executionEnabled\.value&&isSupportedExecution\(item\)/)
 assert.match(view,/v-else-if="canExecute\(item\)"/)
 assert.match(view,/function statusLabel\(item:Approval\)/)
 assert.match(view,/已批准 · 待目标处理/)
 assert.match(view,/目标应用未发生更改/)
 // Backend support is exactly the same narrow subset. Do not widen UI
 // eligibility independently of a matching signed target executor.
 assert.match(executor,/const cash=row\.target_app==='kakebo'&&row\.source_app==='kakebo'/)
 assert.match(executor,/row\.operation==='finance\.entry\.create'&&row\.resource_type==='finance_entry'/)
 assert.match(executor,/const documentFinance=row\.target_app==='kakebo'&&/)
 assert.match(executor,/row\.operation==='document\.sync\.finance'&&/)
 assert.match(executor,/env\.DOCUMENT_EXECUTION_ENABLED!=='true'/)
 assert.match(executor,/typeof env\.DOCUMENT_EXECUTION_SERVICE\?\.fetch!=='function'/)
})


test('approval list discards stale responses when a PWA switches user or status filter',()=>{
 const view=read('../src/components/ApprovalCenter.vue')
 assert.match(view,/let requestGeneration=0/)
 assert.match(view,/let inFlightQuery=''/)
 assert.match(view,/async function discover\(\)\{[\s\S]*?const ticket=\+\+epoch[\s\S]*?requestGeneration\+\+[\s\S]*?loading\.value=false/)
 assert.match(view,/const queryKey=account\+'\|'\+kind\+'\|'\+nextPage/)
 assert.match(view,/if\(loading\.value&&inFlightQuery===queryKey\)return/)
 assert.match(view,/const generation=\+\+requestGeneration/)
 assert.match(view,/if\(ticket!==epoch\|\|generation!==requestGeneration\|\|!props\.active/)
 assert.match(view,/if\(ticket===epoch&&generation===requestGeneration\)[\s\S]*?loading\.value=false/)
 assert.match(view,/filter\.value=value as Filter[\s\S]*?void load\(true\)/)
 // Never poll the approval list on a timer, and never retain a stale
 // household's results after an account swap.
 assert.doesNotMatch(view,/setInterval\(/)
 assert.match(view,/items\.value=\[\];page\.value=0;hasMore\.value=false/)
})
