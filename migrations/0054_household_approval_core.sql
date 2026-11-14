-- 0054: Household approval request/review core.
-- This migration is exclusively in unmerged Draft branches; extend the
-- non-deployed whitelist BEFORE F-stage deployment, not by altering production.
-- Stage D draft; ADDITIVE ONLY. Not deployed/migrated before A backup gate.
-- Actual kakebo/document/study execution is NOT enabled by this migration.
-- Payload bytes remain in the target app's pending storage; HomeFlow keeps
-- only SHA-256 digest and minimal, non-sensitive approval metadata.
CREATE TABLE IF NOT EXISTS household_approval_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  approver_user_id TEXT,
  source_app TEXT NOT NULL CHECK(source_app IN
    ('homeflow','kakebo','jp-document-assistant','it-study-platform')),
  target_app TEXT NOT NULL CHECK(target_app IN
    ('homeflow','kakebo','jp-document-assistant','it-study-platform')),
  operation TEXT NOT NULL CHECK(operation IN
    ('finance.entry.create','finance.credit_card.purchase','finance.credit_card.settlement','finance.prepaid.topup','finance.prepaid.spend',
     'finance.points.earn_campaign','finance.points.earn_purchase',
     'finance.points.redeem_discount','finance.points.redeem_purchase',
     'finance.points.expire','finance.entry.update','finance.entry.delete',
     'finance.entry.restore','finance.account.public_rule.change',
     'document.sync.finance','document.sync.homeflow','document.sync.study',
     'homeflow.shared_task.create')),
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  payload_schema_version INTEGER NOT NULL DEFAULT 1 CHECK(payload_schema_version>=1),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  expected_version INTEGER CHECK(expected_version IS NULL OR expected_version>=0),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','rejected','approved','executing','applied','failed_retryable',
     'failed_final','cancelled','expired','conflict')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  executed_at INTEGER,
  execution_attempts INTEGER NOT NULL DEFAULT 0 CHECK(execution_attempts>=0),
  remote_id TEXT,
  last_error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(household_id,requester_user_id)
    REFERENCES household_members(household_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(household_id,approver_user_id)
    REFERENCES household_members(household_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_household_approvals_household_status
  ON household_approval_requests(household_id,status,created_at DESC,request_id DESC);
CREATE INDEX IF NOT EXISTS idx_household_approvals_requester
  ON household_approval_requests(requester_user_id,created_at DESC,request_id DESC);
CREATE INDEX IF NOT EXISTS idx_household_approvals_pending
  ON household_approval_requests(household_id,created_at DESC)
  WHERE status='pending';
CREATE TABLE IF NOT EXISTS household_approval_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES household_approval_requests(request_id)
    ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('member','owner','system','integration')),
  action TEXT NOT NULL CHECK(action IN
    ('submitted','approved','rejected','cancelled','expired','executing',
     'applied','failed_retryable','failed_final','conflict','retry_claimed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_approval_events_request
  ON household_approval_events(request_id,created_at,event_id);
CREATE INDEX IF NOT EXISTS idx_household_approval_events_actor
  ON household_approval_events(actor_user_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_household_approval_events_immutable_update
BEFORE UPDATE ON household_approval_events
BEGIN SELECT RAISE(ABORT,'APPROVAL_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_household_approval_events_immutable_delete
BEFORE DELETE ON household_approval_events
BEGIN SELECT RAISE(ABORT,'APPROVAL_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_household_approval_request_identity_immutable
BEFORE UPDATE OF request_id,household_id,requester_user_id,source_app,
  target_app,operation,resource_type,resource_id,payload_schema_version,
  payload_sha256,expected_version,idempotency_key,created_at
ON household_approval_requests
BEGIN SELECT RAISE(ABORT,'APPROVAL_REQUEST_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_household_approval_status_transitions
BEFORE UPDATE OF status ON household_approval_requests
WHEN NOT (
  (OLD.status='pending' AND NEW.status IN('approved','rejected','cancelled','expired'))
  OR (OLD.status='approved' AND NEW.status IN('executing','conflict','failed_final'))
  OR (OLD.status='executing' AND NEW.status IN('applied','failed_retryable','failed_final','conflict'))
  OR (OLD.status='failed_retryable' AND NEW.status IN('executing','failed_final','conflict'))
)
BEGIN SELECT RAISE(ABORT,'INVALID_APPROVAL_TRANSITION'); END;

-- A forged approval is not valid merely because somebody changed the status.
-- Even internal future executors must preserve a real household owner actor.
CREATE TRIGGER IF NOT EXISTS trg_household_approval_owner_review
BEFORE UPDATE OF status ON household_approval_requests
WHEN NEW.status IN('approved','rejected') AND (
  NEW.approver_user_id IS NULL
  OR NEW.approver_user_id=OLD.requester_user_id
  OR NOT EXISTS (
    SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
    WHERE m.household_id=NEW.household_id
      AND m.user_id=NEW.approver_user_id AND m.role='owner'
      AND u.disabled_at IS NULL
  )
)
BEGIN SELECT RAISE(ABORT,'APPROVAL_OWNER_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_household_approval_review_actor_frozen
BEFORE UPDATE OF approver_user_id,reviewed_at ON household_approval_requests
WHEN OLD.status!='pending' AND (
  NEW.approver_user_id IS NOT OLD.approver_user_id
  OR NEW.reviewed_at IS NOT OLD.reviewed_at
)
BEGIN SELECT RAISE(ABORT,'APPROVAL_REVIEW_ACTOR_IMMUTABLE'); END;
