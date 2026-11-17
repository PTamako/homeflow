-- Reminder-only tasks keep their ordinary completion and notification lifecycle,
-- but never create a point event or achievement/weekly-point side effect.
-- Existing rows default to regular tasks; historical rewards are not recalculated.
ALTER TABLE tasks ADD COLUMN reminder_only INTEGER NOT NULL DEFAULT 0 CHECK(reminder_only IN (0,1));
ALTER TABLE routines ADD COLUMN reminder_only INTEGER NOT NULL DEFAULT 0 CHECK(reminder_only IN (0,1));

DROP TRIGGER IF EXISTS points_task_completed;
CREATE TRIGGER points_task_completed
AFTER UPDATE OF completed_at,completed_by ON tasks
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
 AND NEW.completed_by IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.reminder_only=0
BEGIN
 INSERT OR IGNORE INTO completion_points
 (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
 VALUES(NEW.household_id,'task',NEW.id,'',NEW.completed_by,NEW.visibility,10,
 strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

DROP TRIGGER IF EXISTS points_routine_completed_insert;
CREATE TRIGGER points_routine_completed_insert
AFTER INSERT ON routine_marks
WHEN NEW.completed_at IS NOT NULL AND NEW.completed_by IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO completion_points
 (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
 SELECT r.household_id,'routine',NEW.routine_id,NEW.occurrence_on,
 NEW.completed_by,r.visibility,10,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM routines r WHERE r.id=NEW.routine_id AND r.deleted_at IS NULL AND r.reminder_only=0;
END;

DROP TRIGGER IF EXISTS points_routine_completed_update;
CREATE TRIGGER points_routine_completed_update
AFTER UPDATE OF completed_at,completed_by ON routine_marks
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
 AND NEW.completed_by IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO completion_points
 (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
 SELECT r.household_id,'routine',NEW.routine_id,NEW.occurrence_on,
 NEW.completed_by,r.visibility,10,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM routines r WHERE r.id=NEW.routine_id AND r.deleted_at IS NULL AND r.reminder_only=0;
END;
