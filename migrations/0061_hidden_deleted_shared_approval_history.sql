-- Hide successfully applied approvals when their physical ledger entries have
-- subsequently been explicitly removed by the owner for a fresh review test.
-- This is a presentation-only tombstone. Never alter the immutable approval
-- or execution journals, which remain necessary for exactly-once accounting.
CREATE TABLE IF NOT EXISTS household_approval_hidden_history (
 request_id TEXT PRIMARY KEY REFERENCES household_approval_requests(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 hidden_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(reason='owner_deleted_shared_entry_for_retest'),
 hidden_at INTEGER NOT NULL CHECK(hidden_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_hidden_shared_approval_owner_only
BEFORE INSERT ON household_approval_hidden_history
WHEN NOT EXISTS (
 SELECT 1 FROM household_approval_requests a
 JOIN household_members m ON m.household_id=a.household_id AND m.user_id=NEW.hidden_by_user_id
 JOIN users u ON u.id=NEW.hidden_by_user_id
 WHERE a.request_id=NEW.request_id AND a.household_id=NEW.household_id
 AND a.status='applied' AND a.source_app='kakebo' AND a.target_app='kakebo'
 AND a.operation='finance.entry.create' AND a.resource_type='shared_entry_mutation'
 AND a.approver_user_id=NEW.hidden_by_user_id AND m.role='owner' AND u.disabled_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'HIDDEN_APPROVAL_OWNER_AND_APPLIED_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_hidden_shared_approval_immutable_update
BEFORE UPDATE ON household_approval_hidden_history
BEGIN SELECT RAISE(ABORT,'HIDDEN_APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_hidden_shared_approval_immutable_delete
BEFORE DELETE ON household_approval_hidden_history
BEGIN SELECT RAISE(ABORT,'HIDDEN_APPROVAL_IMMUTABLE'); END;
