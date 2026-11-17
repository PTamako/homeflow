// Owner approval is restricted to writes to the shared household ledger.
// No task, study, personal-account, bank transfer, points or periodic plan
// may enter this queue merely because a legacy signed API still exists.
const entries=new Set(['finance.entry.create','finance.entry.update',
 'finance.entry.delete','finance.entry.restore']);
export const ledgerOnly=env=>env.OWNER_REVIEW_SCOPE_MODE==='household_ledger_only';
export function ownerReviewAllowed(x){
 if(!x||x.target_app!=='kakebo')return false;
 if(x.source_app==='kakebo')return (
  (x.resource_type==='shared_entry_mutation'&&entries.has(x.operation))||
  (x.resource_type==='finance_entry'&&x.operation==='finance.entry.create'));
 // Syncing a document into Kakeibo adds a household ledger entry.
 return x.source_app==='jp-document-assistant'&&
  x.operation==='document.sync.finance'&&x.resource_type==='document_sync_candidate';
}
// Parameter-independent SQL, exactly equivalent to ownerReviewAllowed().
export const ownerReviewSql=` AND ((source_app='kakeibo' AND target_app='kakeibo' AND
 ((resource_type='shared_entry_mutation' AND operation IN
 ('finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore'))
 OR (resource_type='finance_entry' AND operation='finance.entry.create')))
 OR (source_app='jp-document-assistant' AND target_app='kakeibo' AND
 resource_type='document_sync_candidate' AND operation='document.sync.finance'))`;
