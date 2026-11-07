-- Additive scoring adjustments: preserve already-earned historical points.
-- New one-off self-assigned tasks and routine occurrences receive -5 from the legacy 10,
-- new verified shopping completions receive +2; wishes and savings never earn.
ALTER TABLE tasks ADD COLUMN bonus_points INTEGER NOT NULL DEFAULT 0
  CHECK(bonus_points BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS completion_point_adjustments (
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  occurrence_on TEXT NOT NULL,
  earner_user_id TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  delta INTEGER NOT NULL CHECK(delta=-5),
  earned_at TEXT NOT NULL,
  PRIMARY KEY(household_id,kind,source_id,occurrence_on),
  FOREIGN KEY(household_id,kind,source_id,occurrence_on)
    REFERENCES completion_points(household_id,kind,source_id,occurrence_on) ON DELETE CASCADE
);
CREATE INDEX idx_point_adjustments_user ON completion_point_adjustments(household_id,earner_user_id,visibility);

CREATE TABLE IF NOT EXISTS shopping_completion_points (
  household_id TEXT NOT NULL REFERENCES households(id),
  shopping_id TEXT NOT NULL REFERENCES shopping_items(id) ON DELETE CASCADE,
  earner_user_id TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  points INTEGER NOT NULL DEFAULT 2 CHECK(points=2),
  earned_at TEXT NOT NULL,
  PRIMARY KEY(household_id,shopping_id)
);
CREATE INDEX idx_shopping_points_user ON shopping_completion_points(household_id,earner_user_id,visibility);

CREATE TRIGGER points_adjust_new_completion AFTER INSERT ON completion_points
WHEN NEW.kind='routine' OR (NEW.kind='task' AND EXISTS(
  SELECT 1 FROM tasks t WHERE t.id=NEW.source_id
    AND t.household_id=NEW.household_id AND t.assignee_user_id IS NOT NULL))
BEGIN
  INSERT OR IGNORE INTO completion_point_adjustments
    (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,delta,earned_at)
  VALUES(NEW.household_id,NEW.kind,NEW.source_id,NEW.occurrence_on,
    NEW.earner_user_id,NEW.visibility,-5,NEW.earned_at);
END;

CREATE TRIGGER points_adjust_visibility AFTER UPDATE OF visibility ON completion_points
WHEN OLD.visibility<>NEW.visibility
BEGIN
 UPDATE completion_point_adjustments SET visibility=NEW.visibility
  WHERE household_id=NEW.household_id AND kind=NEW.kind
    AND source_id=NEW.source_id AND occurrence_on=NEW.occurrence_on;
END;

CREATE TRIGGER points_shopping_complete AFTER UPDATE OF completed_at ON shopping_items
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL AND
  NEW.completed_by IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
 INSERT OR IGNORE INTO shopping_completion_points
  (household_id,shopping_id,earner_user_id,visibility,points,earned_at)
 VALUES (NEW.household_id,NEW.id,NEW.completed_by,NEW.visibility,2,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER points_shopping_undo AFTER UPDATE OF completed_at ON shopping_items
WHEN OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL
BEGIN
 DELETE FROM shopping_completion_points WHERE household_id=NEW.household_id AND shopping_id=NEW.id;
END;

CREATE TRIGGER points_shopping_visibility AFTER UPDATE OF visibility ON shopping_items
WHEN OLD.visibility<>NEW.visibility
BEGIN
 UPDATE shopping_completion_points SET visibility=NEW.visibility
 WHERE household_id=NEW.household_id AND shopping_id=NEW.id;
END;

CREATE TRIGGER points_shopping_remove AFTER UPDATE OF deleted_at ON shopping_items
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
 DELETE FROM shopping_completion_points WHERE household_id=NEW.household_id AND shopping_id=NEW.id;
END;

CREATE TRIGGER points_shopping_restore AFTER UPDATE OF deleted_at ON shopping_items
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
 AND NEW.completed_at IS NOT NULL AND NEW.completed_by IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO shopping_completion_points
 (household_id,shopping_id,earner_user_id,visibility,points,earned_at)
 VALUES(NEW.household_id,NEW.id,NEW.completed_by,NEW.visibility,2,
   strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;


-- A verified savings period pays every household member 50 once; never retro-credit
-- completion marks that already existed before this migration.
CREATE TABLE IF NOT EXISTS goal_completion_rewards (
 household_id TEXT NOT NULL REFERENCES households(id),
 goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
 period_key TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 points INTEGER NOT NULL DEFAULT 50 CHECK(points=50),
 awarded_at TEXT NOT NULL,
 PRIMARY KEY(household_id,goal_id,period_key,user_id)
);
CREATE INDEX idx_goal_rewards_member ON goal_completion_rewards(household_id,user_id,awarded_at DESC);

CREATE TRIGGER points_goal_met AFTER INSERT ON plan_completion_marks
WHEN NEW.plan_type='goal'
BEGIN
 INSERT OR IGNORE INTO goal_completion_rewards(household_id,goal_id,period_key,user_id,points,awarded_at)
 SELECT NEW.household_id,NEW.plan_id,NEW.period_key,m.user_id,50,
   strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM goals g JOIN household_members m ON m.household_id=g.household_id
 WHERE g.household_id=NEW.household_id AND g.id=NEW.plan_id
   AND g.visibility='household' AND g.deleted_at IS NULL;
END;

CREATE TRIGGER points_goal_reopened AFTER DELETE ON plan_completion_marks
WHEN OLD.plan_type='goal'
BEGIN
 DELETE FROM goal_completion_rewards
 WHERE household_id=OLD.household_id AND goal_id=OLD.plan_id AND period_key=OLD.period_key;
END;

CREATE TRIGGER points_goal_hidden AFTER UPDATE OF visibility,deleted_at ON goals
WHEN NEW.visibility<>'household' OR NEW.deleted_at IS NOT NULL
BEGIN
 DELETE FROM goal_completion_rewards
 WHERE household_id=NEW.household_id AND goal_id=NEW.id;
END;

CREATE TRIGGER points_goal_restored AFTER UPDATE OF visibility,deleted_at ON goals
WHEN NEW.visibility='household' AND NEW.deleted_at IS NULL
 AND (OLD.visibility<>'household' OR OLD.deleted_at IS NOT NULL)
BEGIN
 INSERT OR IGNORE INTO goal_completion_rewards(household_id,goal_id,period_key,user_id,points,awarded_at)
 SELECT NEW.household_id,NEW.id,p.period_key,m.user_id,50,
   strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM plan_completion_marks p
 JOIN household_members m ON m.household_id=NEW.household_id
 WHERE p.household_id=NEW.household_id AND p.plan_type='goal' AND p.plan_id=NEW.id;
END;
