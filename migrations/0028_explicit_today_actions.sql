-- Explicit Today decisions only. Source plans and recurring schedules are immutable.
-- Skips remain as history; postponed items reappear only on selected date.
CREATE TABLE IF NOT EXISTS today_plan_actions (
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('task','routine','shopping','wish','goal','trip')),
  source_id TEXT NOT NULL,
  original_on TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('postponed','skipped')),
  postponed_to TEXT,
  acted_by TEXT NOT NULL,
  acted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(household_id,kind,source_id,original_on),
  CHECK((action='skipped' AND postponed_to IS NULL) OR
        (action='postponed' AND postponed_to IS NOT NULL AND postponed_to>original_on))
);
CREATE INDEX IF NOT EXISTS idx_today_actions_target
  ON today_plan_actions(household_id,kind,postponed_to,action);
CREATE INDEX IF NOT EXISTS idx_today_actions_history
  ON today_plan_actions(household_id,acted_at DESC);
