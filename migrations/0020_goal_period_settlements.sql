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

-- Saving or changing a period correction invalidates the prior snapshot and
-- any old success mark. The original ledger is never changed; a new verification
-- can safely capture the new estimate. Triggers save a second application write.
CREATE TRIGGER IF NOT EXISTS invalidate_goal_settlement_adjustment_insert
AFTER INSERT ON goal_period_adjustments BEGIN
  UPDATE goal_period_settlements
     SET status='pending',actual_amount=NULL,difference_amount=NULL,
         settled_at=NULL,updated_at=CURRENT_TIMESTAMP
   WHERE household_id=NEW.household_id AND goal_id=NEW.goal_id
     AND period_key=NEW.period_key;
  DELETE FROM plan_completion_marks WHERE household_id=NEW.household_id
    AND plan_type='goal' AND plan_id=NEW.goal_id AND period_key=NEW.period_key;
END;
CREATE TRIGGER IF NOT EXISTS invalidate_goal_settlement_adjustment_update
AFTER UPDATE OF adjustment_amount ON goal_period_adjustments BEGIN
  UPDATE goal_period_settlements
     SET status='pending',actual_amount=NULL,difference_amount=NULL,
         settled_at=NULL,updated_at=CURRENT_TIMESTAMP
   WHERE household_id=NEW.household_id AND goal_id=NEW.goal_id
     AND period_key=NEW.period_key;
  DELETE FROM plan_completion_marks WHERE household_id=NEW.household_id
    AND plan_type='goal' AND plan_id=NEW.goal_id AND period_key=NEW.period_key;
END;
