-- 0057 DRAFT P0-4C: atomic ALL-OR-NOTHING owner batch REVIEW only.
-- This never executes a target app or marks its ledger applied.
-- Each batch is one SQLite INSERT with BEFORE guards and AFTER update + audits;
-- 0 partial approvals on stale item version, member revocation or audit faults.
CREATE TABLE IF NOT EXISTS household_approval_review_batches (
 batch_id TEXT PRIMARY KEY NOT NULL CHECK(length(batch_id)=36),
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
 item_manifest TEXT NOT NULL CHECK(json_valid(item_manifest) AND json_type(item_manifest)='array'),
 item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 20),
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
 reviewed_at INTEGER NOT NULL CHECK(reviewed_at>0)
);
CREATE INDEX IF NOT EXISTS idx_review_batch_owner
 ON household_approval_review_batches(household_id,reviewer_user_id,reviewed_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_review_batch_no_update BEFORE UPDATE ON household_approval_review_batches
 BEGIN SELECT RAISE(ABORT,'BATCH_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_review_batch_no_delete BEFORE DELETE ON household_approval_review_batches
 BEGIN SELECT RAISE(ABORT,'BATCH_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_review_batch_full_preflight
 BEFORE INSERT ON household_approval_review_batches
 WHEN NOT EXISTS(
  SELECT 1 FROM household_members m JOIN users u ON u.id=m.user_id
  WHERE m.household_id=NEW.household_id AND m.user_id=NEW.reviewer_user_id
    AND m.role='owner' AND u.disabled_at IS NULL
 )
 OR json_array_length(NEW.item_manifest)<>NEW.item_count
 OR (SELECT COUNT(DISTINCT json_extract(item.value,'$.request_id'))
     FROM json_each(NEW.item_manifest) item)<>NEW.item_count
 OR EXISTS (
  SELECT 1 FROM json_each(NEW.item_manifest) item
  LEFT JOIN household_approval_requests r
    ON r.request_id=json_extract(item.value,'$.request_id')
  LEFT JOIN household_members member
    ON member.household_id=r.household_id AND member.user_id=r.requester_user_id
  LEFT JOIN users requester ON requester.id=r.requester_user_id
  WHERE json_type(item.value)<>'object'
   OR json_type(item.value,'$.request_id')<>'text'
   OR length(json_extract(item.value,'$.request_id'))<>36
   OR json_type(item.value,'$.expected_version')<>'integer'
   OR json_extract(item.value,'$.expected_version')<1
   OR (SELECT COUNT(*) FROM json_each(item.value))<>2
   OR r.request_id IS NULL OR r.household_id<>NEW.household_id
   OR r.status<>'pending' OR r.version<>json_extract(item.value,'$.expected_version')
   OR r.expires_at<=NEW.reviewed_at OR r.requester_user_id=NEW.reviewer_user_id
   OR member.role<>'member' OR requester.disabled_at IS NOT NULL
 )
 BEGIN SELECT RAISE(ABORT,'BATCH_REVIEW_ALL_OR_NOTHING_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS trg_review_batch_atomic_post
 AFTER INSERT ON household_approval_review_batches
 BEGIN
  UPDATE household_approval_requests SET
   status=CASE WHEN NEW.decision='approve' THEN 'approved' ELSE 'rejected' END,
   approver_user_id=NEW.reviewer_user_id,
   reviewed_at=NEW.reviewed_at,updated_at=NEW.reviewed_at,version=version+1
   WHERE household_id=NEW.household_id AND status='pending'
   AND request_id IN (
    SELECT json_extract(value,'$.request_id') FROM json_each(NEW.item_manifest)
   );
  SELECT RAISE(ABORT,'BATCH_REVIEW_PARTIAL_UPDATE')
   WHERE changes()<>NEW.item_count;
  INSERT INTO household_approval_events
   (event_id,request_id,actor_user_id,actor_type,action,created_at)
   SELECT lower(hex(randomblob(16))),r.request_id,NEW.reviewer_user_id,'owner',
    CASE WHEN NEW.decision='approve' THEN 'approved' ELSE 'rejected' END,NEW.reviewed_at
   FROM household_approval_requests r
   WHERE r.household_id=NEW.household_id AND r.request_id IN (
    SELECT json_extract(value,'$.request_id') FROM json_each(NEW.item_manifest)
   ) AND r.approver_user_id=NEW.reviewer_user_id
     AND r.reviewed_at=NEW.reviewed_at
     AND r.status=CASE WHEN NEW.decision='approve' THEN 'approved' ELSE 'rejected' END;
  SELECT RAISE(ABORT,'BATCH_REVIEW_PARTIAL_AUDIT')
   WHERE changes()<>NEW.item_count;
 END;
