-- Dual assignment is optional and never changes historical completions.
ALTER TABLE tasks ADD COLUMN second_assignee_user_id TEXT REFERENCES users(id);
ALTER TABLE routine_occurrence_assignments ADD COLUMN second_assignee_user_id TEXT REFERENCES users(id);

CREATE INDEX idx_tasks_second_assignee
 ON tasks(household_id,second_assignee_user_id,due_on);
CREATE INDEX idx_routine_second_assignee
 ON routine_occurrence_assignments(household_id,second_assignee_user_id,occurrence_on);

-- The original completion creates one 5-point base record. Each of the two
-- named participants owns exactly half: -2.5 to the completer, +2.5 to partner.
-- This read-only view makes undo, delete, privacy and existing history safe.
CREATE VIEW dual_completion_splits AS
WITH events AS (
 SELECT cp.household_id,cp.kind,cp.source_id,cp.occurrence_on,
        cp.earner_user_id AS completer,cp.visibility,cp.earned_at,
        t.assignee_user_id AS first_user,t.second_assignee_user_id AS second_user
 FROM completion_points cp JOIN tasks t
   ON cp.kind='task' AND cp.source_id=t.id AND cp.household_id=t.household_id
 WHERE t.second_assignee_user_id IS NOT NULL
   AND cp.earner_user_id IN (t.assignee_user_id,t.second_assignee_user_id)
 UNION ALL
 SELECT cp.household_id,cp.kind,cp.source_id,cp.occurrence_on,
        cp.earner_user_id AS completer,cp.visibility,cp.earned_at,
        a.assignee_user_id AS first_user,a.second_assignee_user_id AS second_user
 FROM completion_points cp JOIN routine_occurrence_assignments a
   ON cp.kind='routine' AND cp.source_id=a.routine_id
    AND cp.household_id=a.household_id AND cp.occurrence_on=a.occurrence_on
 WHERE a.second_assignee_user_id IS NOT NULL
   AND cp.earner_user_id IN (a.assignee_user_id,a.second_assignee_user_id)
)
SELECT household_id,kind,source_id,occurrence_on,completer AS user_id,
       visibility,earned_at,-2.5 AS points
FROM events
UNION ALL
SELECT household_id,kind,source_id,occurrence_on,
       CASE WHEN completer=first_user THEN second_user ELSE first_user END AS user_id,
       visibility,earned_at,2.5 AS points
FROM events;
