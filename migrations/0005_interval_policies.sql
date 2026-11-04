-- After 0004: calendar interval recurrence anchored to actual last completion.
ALTER TABLE routines ADD COLUMN next_due_on TEXT;
CREATE INDEX IF NOT EXISTS idx_routines_next_due ON routines(household_id,enabled,next_due_on);
