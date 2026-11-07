-- Additive savings reward migration. Run once AFTER 0036, no historical backfill.
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
