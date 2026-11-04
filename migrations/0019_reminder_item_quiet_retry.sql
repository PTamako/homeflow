-- Optional account quiet hours; NULL = no quiet window (06:00 JST push remains active).
ALTER TABLE reminder_preferences ADD COLUMN quiet_start_hour INTEGER
  CHECK(quiet_start_hour IS NULL OR quiet_start_hour BETWEEN 0 AND 23);
ALTER TABLE reminder_preferences ADD COLUMN quiet_end_hour INTEGER
  CHECK(quiet_end_hour IS NULL OR quiet_end_hour BETWEEN 0 AND 23);

-- Sparse per-account overrides; never change shared plan deadlines.
CREATE TABLE IF NOT EXISTS reminder_item_preferences (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('task','routine','trip')),
  item_id TEXT NOT NULL,
  advance_days INTEGER NOT NULL CHECK(advance_days IN (0,1,3,7)),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','important')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(household_id,user_id,kind,item_id)
);

-- Bound retry attempts without replaying successful pushes.
ALTER TABLE notification_deliveries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0
  CHECK(attempts BETWEEN 0 AND 3);
