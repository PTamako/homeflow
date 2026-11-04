-- Goal/trip/shopping manual adjustments and optional goal accounting window.
-- Existing goals.reserved_amount remains the opening saved amount. No historical rewrite.
CREATE TABLE IF NOT EXISTS finance_target_settings (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('trip','goal','shopping')),
  target_id TEXT NOT NULL,
  adjustment_amount INTEGER NOT NULL DEFAULT 0
    CHECK(adjustment_amount BETWEEN -100000000000 AND 100000000000),
  period_start TEXT,
  period_end TEXT,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(household_id,target_type,target_id),
  CHECK((period_start IS NULL AND period_end IS NULL) OR
        (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start<=period_end))
);

-- Remove only HomeFlow settings when their parent item is deleted.
-- No extra D1 read queries or external ledger writes.
CREATE TRIGGER IF NOT EXISTS cleanup_finance_trip AFTER DELETE ON trips BEGIN
  DELETE FROM finance_target_settings WHERE household_id=OLD.household_id
    AND target_type='trip' AND target_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS cleanup_finance_goal AFTER DELETE ON goals BEGIN
  DELETE FROM finance_target_settings WHERE household_id=OLD.household_id
    AND target_type='goal' AND target_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS cleanup_finance_shopping AFTER DELETE ON shopping_items BEGIN
  DELETE FROM finance_target_settings WHERE household_id=OLD.household_id
    AND target_type='shopping' AND target_id=OLD.id;
END;
