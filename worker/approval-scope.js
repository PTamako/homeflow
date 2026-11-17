// Only writes to the shared Kakeibo household ledger need an owner review.
// Pure asset movements (SBI buys, prepaid topups, bank transfers, points,
// credit-card settlements) are NOT approval intents. Expense purchases are.
const ledgerEntries=new Set(['finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore']);
export const ledgerOnly=env=>env.OWNER_REVIEW_SCOPE_MODE==='household_ledger_only';
export function ownerReviewAllowed(x){
 if(!x||x.target_app!=='kakebo')return false;
 if(x.source_app==='kakebo')return (
  (x.resource_type==='shared_entry_mutation'&&ledgerEntries.has(x.operation))||
  (x.resource_type==='finance_entry'&&x.operation==='finance.entry.create')||
  (x.resource_type==='credit_card_purchase'&&x.operation==='finance.credit_card.purchase')||
  (x.resource_type==='prepaid_action'&&x.operation==='finance.prepaid.spend'));
 return x.source_app==='jp-document-assistant'&&
  x.operation==='document.sync.finance'&&x.resource_type==='document_sync_candidate';
}
export const ownerReviewSql=` AND ((source_app='kakebo' AND target_app='kakebo' AND
 ((resource_type='shared_entry_mutation' AND operation IN
 ('finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore'))
 OR (resource_type='finance_entry' AND operation='finance.entry.create')
 OR (resource_type='credit_card_purchase' AND operation='finance.credit_card.purchase')
 OR (resource_type='prepaid_action' AND operation='finance.prepaid.spend')))
 OR (source_app='jp-document-assistant' AND target_app='kakebo' AND
 resource_type='document_sync_candidate' AND operation='document.sync.finance'))`;
