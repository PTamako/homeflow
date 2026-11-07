-- Explicit one-occurrence overrides, never mutate the recurring template.
-- Only the plan creator can assign a member; bonus reservations are enforced in Worker SQL.
CREATE TABLE routine_occurrence_assignments (
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
 occurrence_on TEXT NOT NULL CHECK(length(occurrence_on)=10),
 assignee_user_id TEXT NOT NULL REFERENCES users(id),
 bonus_points INTEGER NOT NULL CHECK(bonus_points BETWEEN 0 AND 10000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(routine_id,occurrence_on)
);
CREATE INDEX idx_routine_assignment_due
 ON routine_occurrence_assignments(household_id,occurrence_on,assignee_user_id);
CREATE INDEX idx_routine_assignment_user
 ON routine_occurrence_assignments(household_id,assignee_user_id,routine_id);
