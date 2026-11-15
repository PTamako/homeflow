-- 0060 DRAFT: immutable proof of Kakeibo target execution AFTER the ledger
-- has been independently read back through authenticated Kakeibo service binding.
-- Never use reservation itself as an applied ledger; HomeFlow D1 is not atomic
-- with Kakeibo D1. No new production Cron, migration, Secret or binding.
CREATE TABLE IF NOT EXISTS household_recurring_execution_receipts(
 occurrence_id TEXT PRIMARY KEY REFERENCES household_recurring_finance_reservations(occurrence_id) ON DELETE RESTRICT,
 policy_id TEXT NOT NULL REFERENCES household_recurring_finance_policies(policy_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 member_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 owner_authorizer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 plan_resource_id TEXT NOT NULL CHECK(length(plan_resource_id)=32),
 plan_payload_sha256 TEXT NOT NULL CHECK(length(plan_payload_sha256)=64),
 source_account_version INTEGER NOT NULL CHECK(source_account_version>=1),
 period_key TEXT NOT NULL CHECK(length(period_key)=7),
 due_date TEXT NOT NULL CHECK(length(due_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 entry_intent_sha256 TEXT NOT NULL CHECK(length(entry_intent_sha256)=64),
 target_journal_sha256 TEXT NOT NULL CHECK(length(target_journal_sha256)=64),
 target_entry_id INTEGER NOT NULL CHECK(target_entry_id>0),
 target_plan_type TEXT NOT NULL CHECK(target_plan_type IN('fixed_cost','sbi_tsumitate')),
 target_applied_at INTEGER NOT NULL CHECK(target_applied_at>0),
 received_at INTEGER NOT NULL CHECK(received_at>=target_applied_at),
 target_receipt_verified INTEGER NOT NULL CHECK(target_receipt_verified=1),
 external_bank_verified INTEGER NOT NULL CHECK(external_bank_verified=0),
 external_broker_verified INTEGER NOT NULL CHECK(external_broker_verified=0)
);
CREATE INDEX IF NOT EXISTS idx_recurring_execution_applied_household
 ON household_recurring_execution_receipts(household_id,member_user_id,period_key DESC);
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_receipt_guard
BEFORE INSERT ON household_recurring_execution_receipts
WHEN NOT EXISTS(
 SELECT 1 FROM household_recurring_finance_reservations r
 JOIN household_recurring_finance_policies p ON p.policy_id=r.policy_id
 WHERE r.occurrence_id=NEW.occurrence_id AND r.policy_id=NEW.policy_id
 AND r.household_id=NEW.household_id AND r.member_user_id=NEW.member_user_id
 AND r.plan_resource_id=NEW.plan_resource_id
 AND r.plan_payload_sha256=NEW.plan_payload_sha256
 AND r.source_account_version=NEW.source_account_version
 AND r.period_key=NEW.period_key AND r.due_date=NEW.due_date
 AND r.amount_jpy=NEW.amount_jpy AND r.entry_intent_sha256=NEW.entry_intent_sha256
 AND p.plan_type=NEW.target_plan_type
 AND p.household_id=NEW.household_id AND p.member_user_id=NEW.member_user_id
 AND p.owner_user_id=NEW.owner_authorizer_user_id
 AND p.owner_reviewed_at<=NEW.target_applied_at
 AND r.reserved_at<=NEW.target_applied_at AND NEW.target_applied_at<=NEW.received_at
 AND (p.status='approved' OR (p.status='revoked' AND NEW.target_applied_at<=p.updated_at))
)
BEGIN SELECT RAISE(ABORT,'RECURRING_TARGET_RECEIPT_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_receipt_immutable_update
BEFORE UPDATE ON household_recurring_execution_receipts
BEGIN SELECT RAISE(ABORT,'RECURRING_TARGET_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_receipt_immutable_delete
BEFORE DELETE ON household_recurring_execution_receipts
BEGIN SELECT RAISE(ABORT,'RECURRING_TARGET_RECEIPT_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS household_recurring_execution_events(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 occurrence_id TEXT NOT NULL REFERENCES household_recurring_execution_receipts(occurrence_id) ON DELETE RESTRICT,
 policy_id TEXT NOT NULL,
 actor_type TEXT NOT NULL CHECK(actor_type='verified_service_binding'),
 action TEXT NOT NULL CHECK(action='ledger_receipt_verified'),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>0),
 UNIQUE(occurrence_id,action)
);
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_auto_audit
AFTER INSERT ON household_recurring_execution_receipts
BEGIN
 INSERT INTO household_recurring_execution_events(event_id,occurrence_id,
 policy_id,actor_type,action,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.occurrence_id,NEW.policy_id,
 'verified_service_binding','ledger_receipt_verified',NEW.received_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_events_immutable_update
BEFORE UPDATE ON household_recurring_execution_events
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_events_immutable_delete
BEFORE DELETE ON household_recurring_execution_events
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_AUDIT_IMMUTABLE'); END;
