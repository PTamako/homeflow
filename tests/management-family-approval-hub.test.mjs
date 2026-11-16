import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const manage=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
const policies=readFileSync(new URL('../src/components/RecurringFinancePolicyCenter.vue',import.meta.url),'utf8')
const server=readFileSync(new URL('../worker/recurring-finance-policies.js',import.meta.url),'utf8')
const member=readFileSync(new URL('../src/components/CrossMemberTransferConsents.vue',import.meta.url),'utf8')

test('owner approval and recurring policies share one family review panel with two sub-tabs',()=>{
 const family=manage.slice(manage.indexOf('id="management-family-panel"'))
 assert.match(family,/class="panel management-family-approval-hub"/)
 assert.match(family,/role="tablist" aria-label="家庭审批类型"/)
 assert.match(family,/id="family-approval-requests-tab"/)
 assert.match(family,/id="family-approval-recurring-tab"/)
 assert.match(family,/approvalSection==='requests'/)
 assert.match(family,/v-if="approvalSection==='requests'"/)
 assert.match(family,/id="family-approval-recurring-panel"/)
 assert.match(family,/<ApprovalCenter v-if="active&&isOwner"/)
 assert.match(family,/<RecurringFinancePolicyCenter v-if="active&&isOwner"/)
 const panels=[...family.matchAll(/<RecurringFinancePolicyCenter/g)]
 assert.equal(panels.length,1,'owner must not see a separate duplicate recurring card')
})
test('member confirmations remain in personal management only, without owner controls',()=>{
 const personal=manage.slice(manage.indexOf('id="management-personal-panel"'),manage.indexOf('id="management-family-panel"'))
 assert.match(personal,/v-if="!isOwner"/)
 assert.match(personal,/<RecurringFinancePolicyCenter v-if="active"/)
 assert.match(personal,/<CrossMemberTransferConsents v-if="active"/)
 assert.match(member,/if\(x.status==='awaiting_recipient'&&x.recipient_user_id===props.userId\)/)
 assert.match(manage,/if\(!isOwner\)\{section.value='personal';approvalSection.value='requests'\}/)
})
test('standing authorization is reviewed once, not each period; separate receipt evidence remains',()=>{
 assert.match(policies,/approve:'批准整个计划'/)
 assert.match(policies,/无需每月重复批准/)
 assert.match(server,/const previous=action==='revoke'\?'approved':'pending_owner'/)
 assert.match(server,/if\(p.status!==previous\)return invalid\('recurring_policy_not_mutable'\)/)
 assert.match(server,/if\(review&&r!=='owner'\)/)
 assert.match(manage,/每期仍须凭实际发生凭证单独记账/)
})
