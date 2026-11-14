-- P0-2 HomeFlow task target transaction kernel. UNEXECUTED DRAFT.
-- No HTTP execution route is exposed by this migration.
CREATE TABLE IF NOT EXISTS document_task_applied_actions (
 request_id TEXT PRIMARY KEY REFERENCES household_approval_requests(request_id) ON DELETE RESTRICT,
 candidate_id TEXT NOT NULL UNIQUE CHECK(length(candidate_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL,
 approver_user_id TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 operation_sha256 TEXT NOT NULL CHECK(length(operation_sha256)=64),
 task_id TEXT NOT NULL UNIQUE CHECK(length(task_id)=36),
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 CHECK(requester_user_id<>approver_user_id)
);
CREATE INDEX IF NOT EXISTS idx_document_task_applied_household
 ON document_task_applied_actions(household_id,requester_user_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_document_task_journal_immutable_update
 BEFORE UPDATE ON document_task_applied_actions
 BEGIN SELECT RAISE(ABORT,'DOCUMENT_TASK_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_document_task_journal_immutable_delete
 BEFORE DELETE ON document_task_applied_actions
 BEGIN SELECT RAISE(ABORT,'DOCUMENT_TASK_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_document_task_journal_valid
 BEFORE INSERT ON document_task_applied_actions
 WHEN NOT EXISTS (
  SELECT 1 FROM tasks t
  JOIN household_approval_requests r ON r.request_id=NEW.request_id
  JOIN household_members m ON m.household_id=r.household_id AND m.user_id=r.requester_user_id
  JOIN users mu ON mu.id=m.user_id
  JOIN household_members o ON o.household_id=r.household_id AND o.user_id=r.approver_user_id
  JOIN users ou ON ou.id=o.user_id
  WHERE t.id=NEW.task_id AND t.client_request_id=r.request_id
   AND t.household_id=r.household_id AND t.creator_user_id=r.requester_user_id
   AND t.deleted_at IS NULL AND t.completed_at IS NULL
   AND r.status='executing' AND r.source_app='jp-document-assistant'
   AND r.target_app='homeflow' AND r.operation='document.sync.homeflow'
   AND r.resource_type='document_sync_candidate'
   AND r.resource_id=NEW.candidate_id
   AND r.idempotency_key='jpda:sync:'||NEW.candidate_id
   AND r.household_id=NEW.household_id
   AND r.requester_user_id=NEW.requester_user_id
   AND r.approver_user_id=NEW.approver_user_id
   AND r.payload_sha256=NEW.payload_sha256
   AND r.execution_nonce_hash IS NOT NULL
   AND r.execution_lease_until>NEW.applied_at AND r.expires_at>NEW.applied_at
   AND m.role='member' AND o.role='owner'
   AND mu.disabled_at IS NULL AND ou.disabled_at IS NULL
 ) BEGIN SELECT RAISE(ABORT,'DOCUMENT_TASK_APPROVAL_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_document_task_record_applied
 AFTER INSERT ON document_task_applied_actions
 BEGIN
  UPDATE household_approval_requests SET status='applied',
   remote_id=NEW.task_id,executed_at=NEW.applied_at,updated_at=NEW.applied_at,
   execution_nonce_hash=NULL,execution_lease_until=NULL,
   last_error_code=NULL,version=version+1
   WHERE request_id=NEW.request_id AND status='executing'
     AND household_id=NEW.household_id AND requester_user_id=NEW.requester_user_id
     AND approver_user_id=NEW.approver_user_id
     AND resource_id=NEW.candidate_id AND payload_sha256=NEW.payload_sha256;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'DOCUMENT_TASK_APPLY_CONFLICT') END;
  INSERT INTO household_approval_events
   (event_id,request_id,actor_user_id,actor_type,action,created_at)
   VALUES(lower(hex(randomblob(16))),NEW.request_id,NEW.approver_user_id,
    'integration','applied',NEW.applied_at);
 END;
