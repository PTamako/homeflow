import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
test('both cheap request preflight and deep health-check cover 0053–0060',()=>{
 const source=read('../worker/security.js')
 for(const migration of [
 '0053_oauth_code_exchange.sql','0054_household_approval_core.sql',
 '0055_household_approval_execution_lease.sql','0056_document_task_apply.sql',
 '0057_household_batch_reviews.sql','0058_cross_member_transfer_consents.sql',
 '0059_recurring_financial_authorizations.sql','0060_recurring_execution_receipts.sql'
 ])assert.ok(source.split(migration).length>=3,'both gate paths must include '+migration)
 for(const gate of ['finance_migrations_ready','finance_tables_ready',
 'finance_indexes_ready','finance_triggers_ready'])assert.ok(source.includes(gate))
 assert.match(source,/Number\(identity\.finance_tables_ready\)===15/)
 assert.match(source,/Number\(identity\.finance_indexes_ready\)===8/)
 assert.match(source,/Number\(identity\.finance_triggers_ready\)===8/)
})
