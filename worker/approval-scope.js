// Owner approval is restricted to ACTUAL writes to the shared household ledger.
// Personal settings, plans, points balances, document tasks and study sync are
// not ledger mutations. Some financial actions (card purchases/settlements,
// prepaid payments and verified bank transfers) DO create entries; keep those
// actions reviewable instead of accidentally blocking normal member bookkeeping.
const entries=new Set(['finance.entry.create','finance.entry.update',
 'finance.entry.delete','finance.entry.restore']);
const postedFinancial=new Map([
 ['finance.credit_card.purchase','credit_card_purchase'],
 ['finance.credit_card.settlement','credit_card_settlement'],
 ['finance.asset_transfer.bank_to_bank','bank_transfer_posted'],
 ['finance.prepaid.topup','prepaid_action'],
 ['finance.prepaid.spend','prepaid_action']
]);
export const ledgerOnly=env=>env.OWNER_REVIEW_SCOPE_MODE==='household_ledger_only';
export function ownerReviewAllowed(x){
 if(!x||x.target_app!=='kakebo')return false;
 if(x.source_app==='kakebo')return (
  (x.resource_type==='shared_entry_mutation'&&entries.has(x.operation))||
  (x.resource_type==='finance_entry'&&x.operation==='finance.entry.create')||
  postedFinancial.get(x.operation)===x.resource_type);
 // Syncing a document into Kakeibo adds a household ledger entry.
 return x.source_app==='jp-document-assistant'&&
  x.operation==='document.sync.finance'&&x.resource_type==='document_sync_candidate';
}
// Parameter-independent SQL, exactly equivalent to ownerReviewAllowed().
export const ownerReviewSql=` AND ((source_app='kakebo' AND target_app='kakebo' AND
 ((resource_type='shared_entry_mutation' AND operation IN
 ('finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore'))
 OR (resource_type='finance_entry' AND operation='finance.entry.create')
 OR (resource_type='credit_card_purchase' AND operation='finance.credit_card.purchase')
 OR (resource_type='credit_card_settlement' AND operation='finance.credit_card.settlement')
 OR (resource_type='bank_transfer_posted' AND operation='finance.asset_transfer.bank_to_bank')
 OR (resource_type='prepaid_action' AND operation IN ('finance.prepaid.topup','finance.prepaid.spend'))))
 OR (source_app='jp-document-assistant' AND target_app='kakebo' AND
 resource_type='document_sync_candidate' AND operation='document.sync.finance'))`;
