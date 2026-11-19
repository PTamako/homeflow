-- One lightweight state per card and rightful owner, no balance/history replication.
-- Trigger exactly once on a new low-balance crossing or owner setting revision.
CREATE TABLE IF NOT EXISTS prepaid_alert_observations (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_scope TEXT NOT NULL CHECK(account_scope IN ('legacy','member')),
  card_key TEXT NOT NULL CHECK(length(card_key) BETWEEN 1 AND 160),
  settings_version INTEGER NOT NULL CHECK(settings_version>=1),
  is_below INTEGER NOT NULL CHECK(is_below IN (0,1)),
  cycle INTEGER NOT NULL DEFAULT 0 CHECK(cycle>=0),
  triggered_on TEXT,
  PRIMARY KEY(household_id,recipient_user_id,account_scope,card_key)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_alert_observations_owner
 ON prepaid_alert_observations(household_id,recipient_user_id);
