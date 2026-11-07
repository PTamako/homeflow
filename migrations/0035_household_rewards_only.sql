-- Family shop accepts only credits from household-visible completions.
-- Weekly challenge bonuses therefore require ten household-visible completions
-- within the same JST Monday-Sunday week; private completions still grant XP.
DROP TRIGGER IF EXISTS rewards_weekly_points_earned;
DROP TRIGGER IF EXISTS rewards_weekly_points_revoked;

CREATE TRIGGER rewards_weekly_points_earned
AFTER INSERT ON completion_points
WHEN NEW.visibility='household'
BEGIN
  INSERT OR IGNORE INTO weekly_challenge_awards
    (household_id,user_id,week_on,points,awarded_at)
  SELECT NEW.household_id,NEW.earner_user_id,
    date(NEW.earned_at,'+9 hours','weekday 0','-6 days'),30,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE (SELECT COUNT(*) FROM completion_points cp
      WHERE cp.household_id=NEW.household_id AND cp.earner_user_id=NEW.earner_user_id
        AND cp.visibility='household'
        AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
            date(NEW.earned_at,'+9 hours','weekday 0','-6 days'))>=10;
END;

CREATE TRIGGER rewards_weekly_points_revoked
AFTER DELETE ON completion_points
WHEN OLD.visibility='household'
BEGIN
  DELETE FROM weekly_challenge_awards
  WHERE household_id=OLD.household_id AND user_id=OLD.earner_user_id
    AND week_on=date(OLD.earned_at,'+9 hours','weekday 0','-6 days')
    AND (SELECT COUNT(*) FROM completion_points cp
      WHERE cp.household_id=OLD.household_id AND cp.earner_user_id=OLD.earner_user_id
        AND cp.visibility='household'
        AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
            date(OLD.earned_at,'+9 hours','weekday 0','-6 days'))<10;
END;

-- Moving an existing task between shared and private must also recheck its bonus.
CREATE TRIGGER rewards_weekly_points_visibility
AFTER UPDATE OF visibility ON completion_points
WHEN OLD.visibility<>NEW.visibility
BEGIN
  DELETE FROM weekly_challenge_awards
  WHERE household_id=OLD.household_id AND user_id=OLD.earner_user_id
    AND week_on=date(OLD.earned_at,'+9 hours','weekday 0','-6 days')
    AND (SELECT COUNT(*) FROM completion_points cp
      WHERE cp.household_id=OLD.household_id AND cp.earner_user_id=OLD.earner_user_id
        AND cp.visibility='household'
        AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
            date(OLD.earned_at,'+9 hours','weekday 0','-6 days'))<10;
  INSERT OR IGNORE INTO weekly_challenge_awards
    (household_id,user_id,week_on,points,awarded_at)
  SELECT NEW.household_id,NEW.earner_user_id,
    date(NEW.earned_at,'+9 hours','weekday 0','-6 days'),30,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE NEW.visibility='household' AND (SELECT COUNT(*) FROM completion_points cp
      WHERE cp.household_id=NEW.household_id AND cp.earner_user_id=NEW.earner_user_id
        AND cp.visibility='household'
        AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
            date(NEW.earned_at,'+9 hours','weekday 0','-6 days'))>=10;
END;

-- Remove legacy weekly awards only if earned through a mix of private tasks.
DELETE FROM weekly_challenge_awards
WHERE (SELECT COUNT(*) FROM completion_points cp
    WHERE cp.household_id=weekly_challenge_awards.household_id
      AND cp.earner_user_id=weekly_challenge_awards.user_id
      AND cp.visibility='household'
      AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
          weekly_challenge_awards.week_on)<10;
