-- 0055 Stage D execution lease (UNEXECUTED, additive to 0054).
-- Blocked by A-stage encrypted 4 D1/R2 backups and isolated restore.
-- A claimed approval is NOT applied until the remote target proves actual
-- ledger posting; a lost response must be retried with the same approval ID.
ALTER TABLE household_approval_requests ADD COLUMN execution_nonce_hash TEXT;
ALTER TABLE household_approval_requests ADD COLUMN execution_lease_until INTEGER;
CREATE INDEX IF NOT EXISTS idx_household_approval_exec_leases
 ON household_approval_requests(status,execution_lease_until)
 WHERE status='executing';
CREATE TRIGGER IF NOT EXISTS trg_approval_execution_claim_requires_nonce
 BEFORE UPDATE OF status ON household_approval_requests
 WHEN NEW.status='executing' AND (
  NEW.execution_nonce_hash IS NULL OR length(NEW.execution_nonce_hash)!=64
  OR NEW.execution_lease_until IS NULL
  OR NEW.execution_lease_until<=NEW.updated_at
 )
 BEGIN SELECT RAISE(ABORT,'EXECUTION_LEASE_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_approval_execution_release_nonce
 BEFORE UPDATE OF status ON household_approval_requests
 WHEN OLD.status='executing' AND NEW.status!='executing' AND (
  NEW.execution_nonce_hash IS NOT NULL OR NEW.execution_lease_until IS NOT NULL
 )
 BEGIN SELECT RAISE(ABORT,'EXECUTION_NONCE_NOT_CLEARED'); END;
-- The execution_nonce_hash is strictly an internal transient claim proof.
-- Never send it to public approval APIs or audit logs.
