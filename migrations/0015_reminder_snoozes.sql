-- User-scoped sparse reminder snoozes. No change to due dates or reminders history.
CREATE TABLE IF NOT EXISTS reminder_snoozes (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('task','routine','anniversary','trip')),
  item_id TEXT NOT NULL,
  until_on TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(household_id,user_id,kind,item_id)
);
CREATE INDEX IF NOT EXISTS idx_reminder_snoozes_expiration
  ON reminder_snoozes(household_id,user_id,until_on);
