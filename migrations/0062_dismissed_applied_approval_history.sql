-- Presentation-only dismissal: immutable approvals and actual ledger remain untouched.
CREATE TABLE IF NOT EXISTS household_approval_dismissed_history(
 request_id TEXT PRIMARY KEY REFERENCES household_approval_requests(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 dismissed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 dismissed_at INTEGER NOT NULL CHECK(dismissed_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_dismissed_approval_owner_applied
BEFORE INSERT ON household_approval_dismissed_history
WHEN NOT EXISTS (
 SELECT 1 FROM household_approval_requests a
 JOIN household_members m ON m.household_id=a.household_id AND m.user_id=NEW.dismissed_by_user_id
 JOIN users u ON u.id=NEW.dismissed_by_user_id
 WHERE a.request_id=NEW.request_id AND a.household_id=NEW.household_id
 AND a.status='applied' AND a.source_app='kakebo' AND a.target_app='kakebo'
 AND a.resource_type='shared_entry_mutation'
 AND a.operation IN ('finance.entry.create','finance.entry.update','finance.entry.delete','finance.entry.restore')
 AND a.approver_user_id=NEW.dismissed_by_user_id
 AND m.role='owner' AND u.disabled_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'DISMISSED_APPROVAL_OWNER_AND_APPLIED_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_dismissed_approval_immutable_update
BEFORE UPDATE ON household_approval_dismissed_history
BEGIN SELECT RAISE(ABORT,'DISMISSED_APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_dismissed_approval_immutable_delete
BEFORE DELETE ON household_approval_dismissed_history
BEGIN SELECT RAISE(ABORT,'DISMISSED_APPROVAL_IMMUTABLE'); END;
