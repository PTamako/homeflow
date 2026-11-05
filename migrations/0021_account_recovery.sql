-- Additive, no existing account or session data is touched.
-- High-entropy recovery codes are only stored as salted-by-user SHA-256 hashes.
CREATE TABLE IF NOT EXISTS account_recovery_codes (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 used_at TEXT,
 PRIMARY KEY (user_id,code_hash)
);
