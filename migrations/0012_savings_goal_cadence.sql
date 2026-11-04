-- Goal cadence: accumulated (once), per-calendar-month and per-calendar-year.
-- Older goals remain once and keep their saved reserved_amount and finance settings.
ALTER TABLE goals ADD COLUMN goal_mode TEXT NOT NULL DEFAULT 'once'
  CHECK(goal_mode IN ('once','monthly','yearly'));
ALTER TABLE goals ADD COLUMN start_on TEXT;

-- Each monthly/yearly period has its own signed correction.
-- No copies of kakeibo transactions or derived historical financial totals.
CREATE TABLE IF NOT EXISTS goal_period_adjustments (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  adjustment_amount INTEGER NOT NULL DEFAULT 0
    CHECK(adjustment_amount BETWEEN -100000000000 AND 100000000000),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(household_id,goal_id,period_key)
);
