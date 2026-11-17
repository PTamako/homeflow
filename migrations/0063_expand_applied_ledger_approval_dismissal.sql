-- Only owner-reviewed, truly applied household ledger actions may be hidden
-- from presentation. Never mutate ledger entries or immutable audit journals.
DROP TRIGGER IF EXISTS trg_dismissed_approval_owner_applied;
CREATE TRIGGER trg_dismissed_approval_owner_applied
BEFORE INSERT ON household_approval_dismissed_history
WHEN NOT EXISTS (
 SELECT 1 FROM household_approval_requests a
 JOIN household_members m ON m.household_id=a.household_id AND m.user_id=NEW.dismissed_by_user_id
 JOIN users u ON u.id=NEW.dismissed_by_user_id
 WHERE a.request_id=NEW.request_id AND a.household_id=NEW.household_id
 AND a.status='applied' AND a.approver_user_id=NEW.dismissed_by_user_id
 AND m.role='owner' AND u.disabled_at IS NULL
 AND (
   (a.source_app='kakebo' AND a.target_app='kakebo' AND (
      (a.resource_type='shared_entry_mutation' AND a.operation IN
       ('finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore'))
      OR (a.resource_type='finance_entry' AND a.operation='finance.entry.create')
      OR (a.resource_type='credit_card_purchase' AND a.operation='finance.credit_card.purchase')
      OR (a.resource_type='prepaid_action' AND a.operation='finance.prepaid.spend')
   ))
   OR (a.source_app='jp-document-assistant' AND a.target_app='kakebo'
       AND a.resource_type='document_sync_candidate' AND a.operation='document.sync.finance')
 )
)
BEGIN SELECT RAISE(ABORT,'DISMISSED_APPROVAL_OWNER_AND_APPLIED_REQUIRED'); END;
