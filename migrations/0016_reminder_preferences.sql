-- Optional user-level notification lead time. No changes to task due dates.
CREATE TABLE IF NOT EXISTS reminder_preferences (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  advance_days INTEGER NOT NULL DEFAULT 0 CHECK(advance_days IN (0,1,3,7)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (household_id,user_id)
);
