-- Keep a factual, per-period snapshot. Never copy individual Kakebo entries.
-- A NULL actual/difference and pending status means verification is unavailable,
-- not a zero balance or a failed savings attempt.
CREATE TABLE IF NOT EXISTS goal_period_settlements (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  target_amount INTEGER NOT NULL,
  actual_amount INTEGER,
  difference_amount INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','met','shortfall')),
  calculation_basis TEXT NOT NULL DEFAULT 'household_net_cashflow_estimate',
  settled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (household_id,goal_id,period_key),
  CHECK ((status='pending' AND actual_amount IS NULL AND difference_amount IS NULL)
      OR (status IN ('met','shortfall') AND actual_amount IS NOT NULL AND difference_amount IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_goal_settlements_goal_period
  ON goal_period_settlements(household_id,goal_id,period_key DESC);
