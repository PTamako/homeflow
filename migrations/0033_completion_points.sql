-- Family points are earned by the account that actually completes a task.
-- No historical completions are imported; only transitions after this migration earn points.
-- Private completions are visible only in the earner's private balance.
CREATE TABLE IF NOT EXISTS completion_points (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('task','routine')),
  source_id TEXT NOT NULL,
  occurrence_on TEXT NOT NULL DEFAULT '',
  earner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  points INTEGER NOT NULL DEFAULT 10 CHECK(points=10),
  earned_at TEXT NOT NULL,
  PRIMARY KEY(household_id,kind,source_id,occurrence_on)
);
CREATE INDEX IF NOT EXISTS idx_completion_points_member
  ON completion_points(household_id,earner_user_id,visibility,earned_at DESC);

CREATE TRIGGER IF NOT EXISTS points_task_completed
AFTER UPDATE OF completed_at,completed_by ON tasks
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
 AND NEW.completed_by IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT OR IGNORE INTO completion_points
    (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
  VALUES (NEW.household_id,'task',NEW.id,'',NEW.completed_by,NEW.visibility,10,
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS points_task_reopened
AFTER UPDATE OF completed_at ON tasks
WHEN OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL
BEGIN
  DELETE FROM completion_points WHERE household_id=NEW.household_id
    AND kind='task' AND source_id=NEW.id AND occurrence_on='';
END;
CREATE TRIGGER IF NOT EXISTS points_task_visibility
AFTER UPDATE OF visibility ON tasks
WHEN OLD.visibility<>NEW.visibility
BEGIN
  UPDATE completion_points SET visibility=NEW.visibility
  WHERE household_id=NEW.household_id AND kind='task' AND source_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS points_task_permanent_delete
AFTER DELETE ON tasks
BEGIN
  DELETE FROM completion_points WHERE household_id=OLD.household_id
    AND kind='task' AND source_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS points_routine_completed_insert
AFTER INSERT ON routine_marks
WHEN NEW.completed_at IS NOT NULL AND NEW.completed_by IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO completion_points
    (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
  SELECT r.household_id,'routine',NEW.routine_id,NEW.occurrence_on,
    NEW.completed_by,r.visibility,10,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM routines r WHERE r.id=NEW.routine_id AND r.deleted_at IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS points_routine_completed_update
AFTER UPDATE OF completed_at,completed_by ON routine_marks
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
 AND NEW.completed_by IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO completion_points
    (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
  SELECT r.household_id,'routine',NEW.routine_id,NEW.occurrence_on,
    NEW.completed_by,r.visibility,10,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM routines r WHERE r.id=NEW.routine_id AND r.deleted_at IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS points_routine_reopened
AFTER UPDATE OF completed_at ON routine_marks
WHEN OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL
BEGIN
  DELETE FROM completion_points WHERE kind='routine'
    AND source_id=NEW.routine_id AND occurrence_on=NEW.occurrence_on;
END;
CREATE TRIGGER IF NOT EXISTS points_routine_mark_deleted
AFTER DELETE ON routine_marks
BEGIN
  DELETE FROM completion_points WHERE kind='routine'
    AND source_id=OLD.routine_id AND occurrence_on=OLD.occurrence_on;
END;
CREATE TRIGGER IF NOT EXISTS points_routine_visibility
AFTER UPDATE OF visibility ON routines
WHEN OLD.visibility<>NEW.visibility
BEGIN
  UPDATE completion_points SET visibility=NEW.visibility
  WHERE household_id=NEW.household_id AND kind='routine' AND source_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS points_routine_permanent_delete
AFTER DELETE ON routines
BEGIN
  DELETE FROM completion_points WHERE household_id=OLD.household_id
    AND kind='routine' AND source_id=OLD.id;
END;
