-- 0059 DRAFT P0-4C: bounded, owner-approved monthly financial policy.
-- This is policy AND reservation accounting only, NEVER a ledger entry or Cron.
-- No bank, prepaid, SBI, or R2 records are changed. Production remains OFF.
CREATE TABLE IF NOT EXISTS household_recurring_finance_policies(
 policy_id TEXT PRIMARY KEY CHECK(length(policy_id)=36),
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 member_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 plan_resource_id TEXT NOT NULL CHECK(length(plan_resource_id)=32 AND plan_resource_id NOT GLOB '*[^0-9a-f]*'),
 plan_payload_sha256 TEXT NOT NULL CHECK(length(plan_payload_sha256)=64 AND plan_payload_sha256 NOT GLOB '*[^0-9a-f]*'),
 plan_type TEXT NOT NULL CHECK(plan_type IN ('fixed_cost','sbi_tsumitate')),
 source_account_version INTEGER NOT NULL CHECK(source_account_version>=1),
 due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
 max_amount_jpy INTEGER NOT NULL CHECK(max_amount_jpy BETWEEN 1 AND 10000000),
 start_month TEXT NOT NULL CHECK(length(start_month)=7 AND start_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]'),
 end_month TEXT NOT NULL CHECK(length(end_month)=7 AND end_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]'),
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL DEFAULT 'pending_owner'
  CHECK(status IN ('pending_owner','approved','rejected','cancelled','revoked')),
 owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 owner_reviewed_at INTEGER,
 last_actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 CHECK(start_month<=end_month AND substr(start_month,6,2) BETWEEN '01' AND '12' AND substr(end_month,6,2) BETWEEN '01' AND '12'),
 CHECK((status IN ('pending_owner','cancelled') AND owner_user_id IS NULL AND owner_reviewed_at IS NULL)
   OR (status IN ('approved','rejected','revoked') AND owner_user_id IS NOT NULL AND owner_reviewed_at IS NOT NULL)),
 UNIQUE(household_id,member_user_id,plan_resource_id,plan_payload_sha256,source_account_version)
);
CREATE INDEX IF NOT EXISTS idx_recurring_policy_member
 ON household_recurring_finance_policies(household_id,member_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recurring_policy_status
 ON household_recurring_finance_policies(household_id,status,expires_at);
CREATE TABLE IF NOT EXISTS household_recurring_finance_events(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 policy_id TEXT NOT NULL REFERENCES household_recurring_finance_policies(policy_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('member_requested','owner_approved','owner_rejected','member_cancelled',
  'policy_revoked','occurrence_reserved')),
 old_version INTEGER NOT NULL CHECK(old_version>=0),
 new_version INTEGER NOT NULL CHECK(new_version>=old_version),
 occurrence_id TEXT,
 occurred_at INTEGER NOT NULL CHECK(occurred_at>0),
 UNIQUE(policy_id,action,new_version,occurrence_id)
);
CREATE TRIGGER IF NOT EXISTS trg_recurring_finance_event_no_update
 BEFORE UPDATE ON household_recurring_finance_events
 BEGIN SELECT RAISE(ABORT,'RECURRING_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_finance_event_no_delete
 BEFORE DELETE ON household_recurring_finance_events
 BEGIN SELECT RAISE(ABORT,'RECURRING_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_policy_frozen_fields BEFORE UPDATE OF
 policy_id,household_id,member_user_id,plan_resource_id,plan_payload_sha256,
 plan_type,source_account_version,due_day,max_amount_jpy,start_month,end_month,
 idempotency_hash,created_at,expires_at ON household_recurring_finance_policies
 BEGIN SELECT RAISE(ABORT,'RECURRING_POLICY_TERMS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_policy_no_delete
 BEFORE DELETE ON household_recurring_finance_policies
 BEGIN SELECT RAISE(ABORT,'RECURRING_POLICY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_policy_init_guard
 BEFORE INSERT ON household_recurring_finance_policies
 WHEN NEW.status<>'pending_owner' OR NEW.version<>1 OR NEW.owner_user_id IS NOT NULL
 OR NEW.owner_reviewed_at IS NOT NULL OR NEW.last_actor_user_id<>NEW.member_user_id
 OR NEW.updated_at<>NEW.created_at OR NEW.expires_at>NEW.created_at+1209600000
 OR NEW.end_month<NEW.start_month
 OR NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=NEW.household_id AND m.user_id=NEW.member_user_id
   AND m.role='member' AND u.disabled_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'RECURRING_POLICY_MEMBER_OR_TERMS_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_policy_transition
 BEFORE UPDATE ON household_recurring_finance_policies
 WHEN NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at
 OR NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=OLD.household_id AND m.user_id=OLD.member_user_id
   AND m.role='member' AND u.disabled_at IS NULL)
 OR NOT(
  (OLD.status='pending_owner' AND NEW.status IN ('approved','rejected') AND
   NEW.last_actor_user_id=NEW.owner_user_id AND
   NEW.owner_reviewed_at=NEW.updated_at AND NEW.updated_at<OLD.expires_at AND
   EXISTS(SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
    WHERE m.household_id=OLD.household_id AND m.user_id=NEW.owner_user_id
    AND m.role='owner' AND u.disabled_at IS NULL AND m.user_id<>OLD.member_user_id))
  OR
  (OLD.status='pending_owner' AND NEW.status='cancelled' AND
   NEW.last_actor_user_id=OLD.member_user_id AND NEW.owner_user_id IS NULL AND
   NEW.owner_reviewed_at IS NULL)
  OR
  (OLD.status='approved' AND NEW.status='revoked' AND
   NEW.last_actor_user_id IN(OLD.member_user_id,OLD.owner_user_id) AND
   NEW.owner_user_id=OLD.owner_user_id AND NEW.owner_reviewed_at=OLD.owner_reviewed_at)
 )
 BEGIN SELECT RAISE(ABORT,'RECURRING_POLICY_STATE_OR_ACTOR_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_policy_audit_created
 AFTER INSERT ON household_recurring_finance_policies
 BEGIN INSERT INTO household_recurring_finance_events(
 event_id,policy_id,actor_user_id,action,old_version,new_version,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.policy_id,NEW.member_user_id,'member_requested',0,1,NEW.created_at);
 END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_policy_audit_changed
 AFTER UPDATE ON household_recurring_finance_policies
 BEGIN INSERT INTO household_recurring_finance_events(
 event_id,policy_id,actor_user_id,action,old_version,new_version,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.policy_id,NEW.last_actor_user_id,
  CASE NEW.status WHEN 'approved' THEN 'owner_approved'
   WHEN 'rejected' THEN 'owner_rejected'
   WHEN 'cancelled' THEN 'member_cancelled' ELSE 'policy_revoked' END,
  OLD.version,NEW.version,NEW.updated_at);
 END;
-- Durable reservation is NOT a financial entry. An uncertain Kakeibo execution
-- must reuse this original occurrence id; no auto-release or repeat Cron claim.
CREATE TABLE IF NOT EXISTS household_recurring_finance_reservations(
 occurrence_id TEXT PRIMARY KEY CHECK(length(occurrence_id)=32 AND occurrence_id NOT GLOB '*[^0-9a-f]*'),
 policy_id TEXT NOT NULL REFERENCES household_recurring_finance_policies(policy_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 member_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 plan_resource_id TEXT NOT NULL,
 plan_payload_sha256 TEXT NOT NULL CHECK(length(plan_payload_sha256)=64),
 source_account_version INTEGER NOT NULL CHECK(source_account_version>=1),
 period_key TEXT NOT NULL CHECK(length(period_key)=7),
 due_date TEXT NOT NULL CHECK(length(due_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 entry_intent_sha256 TEXT NOT NULL CHECK(length(entry_intent_sha256)=64),
 state TEXT NOT NULL DEFAULT 'reserved_only' CHECK(state='reserved_only'),
 reserved_at INTEGER NOT NULL CHECK(reserved_at>0),
 UNIQUE(household_id,plan_resource_id,period_key),
 UNIQUE(policy_id,period_key),
 UNIQUE(entry_intent_sha256,member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_recurring_reservation_member
 ON household_recurring_finance_reservations(household_id,member_user_id,reserved_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_recurring_reservation_no_update
 BEFORE UPDATE ON household_recurring_finance_reservations
 BEGIN SELECT RAISE(ABORT,'RECURRING_RESERVATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_reservation_no_delete
 BEFORE DELETE ON household_recurring_finance_reservations
 BEGIN SELECT RAISE(ABORT,'RECURRING_RESERVATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_reservation_preflight
 BEFORE INSERT ON household_recurring_finance_reservations
 WHEN NEW.state<>'reserved_only' OR NEW.period_key<>substr(NEW.due_date,1,7)
 OR NOT EXISTS(
  SELECT 1 FROM household_recurring_finance_policies p
  JOIN household_members member ON member.household_id=p.household_id
   AND member.user_id=p.member_user_id
  JOIN users member_u ON member_u.id=p.member_user_id
  JOIN household_members owner ON owner.household_id=p.household_id AND owner.user_id=p.owner_user_id
  JOIN users owner_u ON owner_u.id=p.owner_user_id
  WHERE p.policy_id=NEW.policy_id AND p.status='approved'
   AND p.household_id=NEW.household_id AND p.member_user_id=NEW.member_user_id
   AND p.plan_resource_id=NEW.plan_resource_id
   AND p.plan_payload_sha256=NEW.plan_payload_sha256
   AND p.source_account_version=NEW.source_account_version
   AND p.start_month<=NEW.period_key AND p.end_month>=NEW.period_key
   AND NEW.due_date=NEW.period_key||'-'||printf('%02d',p.due_day)
   AND NEW.amount_jpy<=p.max_amount_jpy
   AND NEW.due_date<=date(NEW.reserved_at/1000,'unixepoch','+9 hours')
   AND NEW.due_date>=date(NEW.reserved_at/1000,'unixepoch','+9 hours','-7 days')
   AND member.role='member' AND owner.role='owner'
   AND member_u.disabled_at IS NULL AND owner_u.disabled_at IS NULL
   AND p.owner_reviewed_at IS NOT NULL AND p.owner_reviewed_at<=NEW.reserved_at)
 BEGIN SELECT RAISE(ABORT,'RECURRING_POLICY_NOT_AUTHORIZED_OR_DUE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_reservation_audit
 AFTER INSERT ON household_recurring_finance_reservations
 BEGIN INSERT INTO household_recurring_finance_events(
 event_id,policy_id,actor_user_id,action,old_version,new_version,occurrence_id,occurred_at)
 SELECT lower(hex(randomblob(16))),NEW.policy_id,NEW.member_user_id,
  'occurrence_reserved',p.version,p.version,NEW.occurrence_id,NEW.reserved_at
  FROM household_recurring_finance_policies p WHERE p.policy_id=NEW.policy_id;
 END;
