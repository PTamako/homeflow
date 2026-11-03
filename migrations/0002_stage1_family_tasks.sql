-- Stage 1: additive, run on Preview first; no personal data is seeded.
-- Existing 0001 tables and environment_identity must already exist.
ALTER TABLE users ADD COLUMN password_rounds INTEGER NOT NULL DEFAULT 160000;
ALTER TABLE family_profiles ADD COLUMN relation TEXT NOT NULL DEFAULT '';
ALTER TABLE family_profiles ADD COLUMN adopted_on TEXT;
ALTER TABLE family_profiles ADD COLUMN weight_grams INTEGER CHECK(weight_grams IS NULL OR (weight_grams > 0 AND weight_grams < 100000));
ALTER TABLE family_profiles ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE family_profiles ADD COLUMN archived_at TEXT;
CREATE TABLE IF NOT EXISTS invitations (
  token_hash TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  issued_by TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invitations_household ON invitations(household_id, expires_at);
-- Protect against concurrent redemption of a one-use invitation.
CREATE TABLE IF NOT EXISTS invitation_redemptions (
  token_hash TEXT PRIMARY KEY REFERENCES invitations(token_hash),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS login_limits (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_ends INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  creator_user_id TEXT NOT NULL REFERENCES users(id),
  assignee_user_id TEXT REFERENCES users(id),
  subject_profile_id TEXT REFERENCES family_profiles(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_on TEXT,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tasks_household_due ON tasks(household_id,deleted_at,due_on,updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_user_id,visibility,deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id,deleted_at,due_on);
