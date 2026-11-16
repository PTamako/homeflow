import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const view=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
const auth=readFileSync(new URL('../worker/auth.js',import.meta.url),'utf8')
const approvals=readFileSync(new URL('../worker/approvals.js',import.meta.url),'utf8')
const consent=readFileSync(new URL('../worker/cross-member-transfer-consents.js',import.meta.url),'utf8')

test('management is split into personal and owner-only family tabs',()=>{
 assert.match(view,/section=ref<'personal'\|'family'>\('personal'\)/)
 assert.match(view,/id="management-personal-tab"[^>]*role="tab"/)
 assert.match(view,/v-if="isOwner" id="management-family-tab"/)
 assert.match(view,/v-if="section==='personal'" id="management-personal-panel"/)
 assert.match(view,/v-else-if="isOwner" id="management-family-panel"/)
 assert.match(view,/if\(!isOwner\)section\.value='personal'/)
 assert.match(view,/if\(!active\)section\.value='personal'/)
})

test('member personal confirmation remains usable without family administration',()=>{
 const personal=view.slice(view.indexOf('id="management-personal-panel"'),view.indexOf('id="management-family-panel"'))
 assert.match(personal,/v-if="!isOwner"/)
 assert.match(personal,/<MemberConfirmationInbox v-if="active&&!isOwner"/)
 for(const component of ['ApprovalCenter','CrossMemberTransferConsents','RecurringFinancePolicyCenter'])
  assert.doesNotMatch(personal,new RegExp('<'+component))
 assert.doesNotMatch(personal,/家庭审批.*查看授权/)
 assert.doesNotMatch(personal,/generateInvite/)
 const family=view.slice(view.indexOf('id="management-family-panel"'))
 assert.match(family,/v-if="isOwner" class="management-family-invites"/)
 assert.match(auth,/session\.role!=='owner'\)return json\(\{error:'forbidden'\},403\)/)
 assert.match(approvals,/action==='review'&&role!=='owner'/)
 assert.match(consent,/action==='authorize'&&role!=='owner'/)
})

test('family-only components do not fetch when family management is not open',()=>{
 const family=view.slice(view.indexOf('id="management-family-panel"'))
 assert.match(family,/<FamilyApprovalFeed v-if="active&&isOwner"/)
 assert.doesNotMatch(family,/approvalSection|family-approval-requests-tab/)
 assert.doesNotMatch(family,/<ApprovalCenter v-if="active&&isOwner"/)
})
