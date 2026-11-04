-- Unified plan hub: one-time task reminders and dated plan follow-ups.
-- Additive migration: no deletes, rewrites, or accounting changes.
ALTER TABLE tasks ADD COLUMN remind_enabled INTEGER NOT NULL DEFAULT 1 CHECK(remind_enabled IN (0,1));
ALTER TABLE routines ADD COLUMN remind_enabled INTEGER NOT NULL DEFAULT 1 CHECK(remind_enabled IN (0,1));
ALTER TABLE wishes ADD COLUMN target_on TEXT;
ALTER TABLE shopping_items ADD COLUMN due_on TEXT;
CREATE INDEX IF NOT EXISTS idx_shopping_due_active ON shopping_items(household_id,due_on)
  WHERE completed_at IS NULL AND due_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wishes_target_active ON wishes(household_id,target_on)
  WHERE target_on IS NOT NULL AND status NOT IN ('completed','cancelled');
CREATE INDEX IF NOT EXISTS idx_goals_target_on ON goals(household_id,target_on)
  WHERE target_on IS NOT NULL;
