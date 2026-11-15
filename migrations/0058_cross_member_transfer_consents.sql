-- 0058 DRAFT P0-4C: BOTH household members independently consent to an
-- opaque financial transfer proposal, followed by a SEPARATE owner authorization.
-- NO financial ledger / banking write, no service binding and no execution proof.
-- The future Kakeibo executor MUST independently verify both account owners,
-- actual bank statements, original digest, live CAS and the current revocation.
CREATE TABLE IF NOT EXISTS household_cross_member_transfer_consents (
 consent_id TEXT PRIMARY KEY NOT NULL CHECK(length(consent_id)=36),
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 source_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 resource_id TEXT NOT NULL CHECK(length(resource_id)=32 AND resource_id NOT GLOB '*[^0-9a-f]*'),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_account_version INTEGER NOT NULL CHECK(source_account_version BETWEEN 1 AND 2147483647),
 recipient_account_version INTEGER NOT NULL CHECK(recipient_account_version BETWEEN 1 AND 2147483647),
 idempotency_hash TEXT NOT NULL UNIQUE
   CHECK(length(idempotency_hash)=64 AND idempotency_hash NOT GLOB '*[^0-9a-f]*'),
 status TEXT NOT NULL DEFAULT 'awaiting_recipient' CHECK(status IN (
  'awaiting_recipient','recipient_accepted','owner_authorized','recipient_rejected',
  'cancelled','revoked')),
 source_confirmed_at INTEGER NOT NULL CHECK(source_confirmed_at>0),
 recipient_decided_at INTEGER,
 owner_authorized_at INTEGER,
 owner_authorizer_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 last_actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 CHECK(source_user_id<>recipient_user_id),
 CHECK(last_actor_user_id IN (source_user_id,recipient_user_id) OR
  last_actor_user_id=owner_authorizer_user_id),
 CHECK((status IN ('awaiting_recipient','recipient_rejected','cancelled') AND
       owner_authorized_at IS NULL AND owner_authorizer_user_id IS NULL)
   OR (status IN ('recipient_accepted','revoked') AND
       (owner_authorized_at IS NULL OR owner_authorizer_user_id IS NOT NULL))
   OR (status='owner_authorized' AND owner_authorized_at IS NOT NULL
       AND owner_authorizer_user_id IS NOT NULL)),
 UNIQUE(household_id,resource_id)
);
CREATE INDEX IF NOT EXISTS idx_cross_transfer_consent_source
 ON household_cross_member_transfer_consents(household_id,source_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_transfer_consent_recipient
 ON household_cross_member_transfer_consents(household_id,recipient_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_transfer_consent_status
 ON household_cross_member_transfer_consents(household_id,status,expires_at);
CREATE TABLE IF NOT EXISTS household_cross_member_transfer_events(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 consent_id TEXT NOT NULL REFERENCES household_cross_member_transfer_consents(consent_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN(
  'source_consented','recipient_accepted','recipient_rejected','owner_authorized',
  'cancelled','revoked')),
 old_version INTEGER NOT NULL CHECK(old_version>=0),
 new_version INTEGER NOT NULL CHECK(new_version=old_version+1),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>0),
 UNIQUE(consent_id,new_version)
);
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_event_no_update
 BEFORE UPDATE ON household_cross_member_transfer_events
 BEGIN SELECT RAISE(ABORT,'CROSS_TRANSFER_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_event_no_delete
 BEFORE DELETE ON household_cross_member_transfer_events
 BEGIN SELECT RAISE(ABORT,'CROSS_TRANSFER_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_consent_immutable
 BEFORE UPDATE OF consent_id,household_id,source_user_id,recipient_user_id,
 resource_id,payload_sha256,source_account_version,recipient_account_version,
 idempotency_hash,source_confirmed_at,created_at,expires_at
 ON household_cross_member_transfer_consents
 BEGIN SELECT RAISE(ABORT,'CROSS_TRANSFER_TERMS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_consent_no_delete
 BEFORE DELETE ON household_cross_member_transfer_consents
 BEGIN SELECT RAISE(ABORT,'CROSS_TRANSFER_CONSENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_consent_identity_insert
 BEFORE INSERT ON household_cross_member_transfer_consents
 WHEN NEW.status<>'awaiting_recipient' OR NEW.version<>1 OR
 NEW.recipient_decided_at IS NOT NULL OR NEW.owner_authorized_at IS NOT NULL OR
 NEW.owner_authorizer_user_id IS NOT NULL OR
 NEW.last_actor_user_id<>NEW.source_user_id OR
 NEW.created_at<>NEW.source_confirmed_at OR NEW.created_at<>NEW.updated_at OR
 NEW.expires_at>NEW.created_at+86400000 OR
 NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=NEW.household_id AND m.user_id=NEW.source_user_id
   AND m.role IN ('owner','member') AND u.disabled_at IS NULL)
 OR NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=NEW.household_id AND m.user_id=NEW.recipient_user_id
   AND m.role IN ('owner','member') AND u.disabled_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'CROSS_TRANSFER_SOURCE_RECIPIENT_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_consent_status_guard
 BEFORE UPDATE ON household_cross_member_transfer_consents
 WHEN NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR
 NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=OLD.household_id AND m.user_id=OLD.source_user_id
   AND m.role IN ('owner','member') AND u.disabled_at IS NULL)
 OR NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=OLD.household_id AND m.user_id=OLD.recipient_user_id
   AND m.role IN ('owner','member') AND u.disabled_at IS NULL)
 OR NOT(
   (OLD.status='awaiting_recipient' AND NEW.status='recipient_accepted' AND
    NEW.last_actor_user_id=OLD.recipient_user_id AND
    NEW.recipient_decided_at=NEW.updated_at AND
    NEW.owner_authorized_at IS NULL AND NEW.owner_authorizer_user_id IS NULL)
   OR
   (OLD.status='awaiting_recipient' AND NEW.status='recipient_rejected' AND
    NEW.last_actor_user_id=OLD.recipient_user_id AND
    NEW.recipient_decided_at=NEW.updated_at AND
    NEW.owner_authorized_at IS NULL AND NEW.owner_authorizer_user_id IS NULL)
   OR
   (OLD.status='recipient_accepted' AND NEW.status='owner_authorized' AND
    NEW.last_actor_user_id=NEW.owner_authorizer_user_id AND
    NEW.owner_authorized_at=NEW.updated_at AND
    NEW.recipient_decided_at=OLD.recipient_decided_at AND
    EXISTS(SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
     WHERE m.household_id=OLD.household_id AND m.user_id=NEW.owner_authorizer_user_id
      AND m.role='owner' AND u.disabled_at IS NULL))
   OR
   (OLD.status IN ('awaiting_recipient','recipient_accepted') AND NEW.status='cancelled' AND
    NEW.last_actor_user_id=OLD.source_user_id AND
    NEW.recipient_decided_at IS OLD.recipient_decided_at AND
    NEW.owner_authorized_at IS NULL AND NEW.owner_authorizer_user_id IS NULL)
   OR
   (OLD.status='owner_authorized' AND NEW.status='revoked' AND
    NEW.last_actor_user_id IN (OLD.source_user_id,OLD.recipient_user_id,OLD.owner_authorizer_user_id)
    AND NEW.recipient_decided_at=OLD.recipient_decided_at AND
    NEW.owner_authorizer_user_id=OLD.owner_authorizer_user_id AND
    NEW.owner_authorized_at=OLD.owner_authorized_at)
 ) OR
 ((OLD.status IN('awaiting_recipient','recipient_accepted') AND
   NEW.status IN('recipient_accepted','recipient_rejected','owner_authorized')) AND
  NEW.updated_at>=OLD.expires_at)
 BEGIN SELECT RAISE(ABORT,'CROSS_TRANSFER_CONSENT_STATE_OR_ACTOR_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_consent_audit_insert
 AFTER INSERT ON household_cross_member_transfer_consents
 BEGIN INSERT INTO household_cross_member_transfer_events(
  event_id,consent_id,actor_user_id,action,old_version,new_version,occurred_at)
  VALUES(lower(hex(randomblob(16))),NEW.consent_id,NEW.source_user_id,
    'source_consented',0,1,NEW.created_at); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_transfer_consent_audit_update
 AFTER UPDATE ON household_cross_member_transfer_consents
 BEGIN INSERT INTO household_cross_member_transfer_events(
  event_id,consent_id,actor_user_id,action,old_version,new_version,occurred_at)
  VALUES(lower(hex(randomblob(16))),NEW.consent_id,NEW.last_actor_user_id,
   CASE NEW.status
    WHEN 'recipient_accepted' THEN 'recipient_accepted'
    WHEN 'recipient_rejected' THEN 'recipient_rejected'
    WHEN 'owner_authorized' THEN 'owner_authorized'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'revoked' END,OLD.version,NEW.version,NEW.updated_at);
 END;
