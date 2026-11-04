-- Durable, per-occurrence completion states for wish and savings follow-ups.
-- This table only stores explicit acknowledgements. No copies of ledger data.
CREATE TABLE IF NOT EXISTS plan_completion_marks (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK(plan_type IN ('wish','goal')),
  plan_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  completed_by TEXT NOT NULL REFERENCES users(id),
  prior_status TEXT,
  PRIMARY KEY(household_id,plan_type,plan_id,period_key)
);
CREATE INDEX IF NOT EXISTS idx_plan_completion_household_date
  ON plan_completion_marks(household_id,completed_at);
CREATE TRIGGER IF NOT EXISTS cleanup_plan_wish_marks AFTER DELETE ON wishes BEGIN
  DELETE FROM plan_completion_marks WHERE household_id=OLD.household_id
    AND plan_type='wish' AND plan_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS cleanup_plan_goal_marks AFTER DELETE ON goals BEGIN
  DELETE FROM plan_completion_marks WHERE household_id=OLD.household_id
    AND plan_type='goal' AND plan_id=OLD.id;
END;
