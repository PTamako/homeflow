-- Month-scoped, idempotent rewards for household-shared activity.
-- History and spendable balances persist; only progress/badge state resets each JST month.
CREATE TABLE monthly_achievement_awards (
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 month_on TEXT NOT NULL CHECK(length(month_on)=7),
 badge_id TEXT NOT NULL CHECK(badge_id IN ('first','routines','challenge','master','pet','streak')),
 points INTEGER NOT NULL CHECK(points IN (5,15,20,35,45,60)),
 awarded_at TEXT NOT NULL,
 PRIMARY KEY(household_id,user_id,month_on,badge_id)
);
CREATE INDEX idx_monthly_achievements_member ON monthly_achievement_awards(household_id,user_id,month_on DESC);

-- All calculations are based on source completion records, never on spending or
-- editable client-supplied badge progress. Private points cannot fund family rewards.
CREATE VIEW monthly_achievement_progress AS
WITH events AS (
 SELECT c.household_id AS household_id,c.earner_user_id AS user_id,
        strftime('%Y-%m',c.earned_at,'+9 hours') AS month_on,
        date(c.earned_at,'+9 hours') AS day_on,c.kind AS kind,
        CASE WHEN EXISTS (
          SELECT 1 FROM family_profiles p WHERE p.household_id=c.household_id
            AND p.type='pet' AND p.archived_at IS NULL AND
            p.id=COALESCE(t.subject_profile_id,r.subject_profile_id)
        ) THEN 1 ELSE 0 END AS pet_care
 FROM completion_points c
 LEFT JOIN tasks t ON c.kind='task' AND t.id=c.source_id AND t.household_id=c.household_id
 LEFT JOIN routines r ON c.kind='routine' AND r.id=c.source_id AND r.household_id=c.household_id
 WHERE c.visibility='household'
), stats AS (
 SELECT household_id,user_id,month_on,COUNT(*) AS task_done,
        COALESCE(SUM(kind='routine'),0) AS routine_done,
        COALESCE(SUM(pet_care),0) AS pet_care_done
 FROM events GROUP BY household_id,user_id,month_on
), days AS (
 SELECT DISTINCT household_id,user_id,month_on,day_on FROM events
), ordered_days AS (
 SELECT household_id,user_id,month_on,day_on,
        CAST(julianday(day_on) AS INTEGER) -
        ROW_NUMBER() OVER (
          PARTITION BY household_id,user_id,month_on ORDER BY day_on
        ) AS run_group
 FROM days
), streak_groups AS (
 SELECT household_id,user_id,month_on,COUNT(*) AS consecutive
 FROM ordered_days GROUP BY household_id,user_id,month_on,run_group
), streaks AS (
 SELECT household_id,user_id,month_on,MAX(consecutive) AS longest_streak
 FROM streak_groups GROUP BY household_id,user_id,month_on
), wins AS (
 SELECT household_id,user_id,strftime('%Y-%m',awarded_at,'+9 hours') AS month_on,
        COUNT(*) AS weekly_wins
 FROM weekly_challenge_awards
 GROUP BY household_id,user_id,strftime('%Y-%m',awarded_at,'+9 hours')
)
SELECT s.household_id,s.user_id,s.month_on,s.task_done,s.routine_done,
       s.pet_care_done,COALESCE(st.longest_streak,0) AS longest_streak,
       COALESCE(w.weekly_wins,0) AS weekly_wins
FROM stats s
LEFT JOIN streaks st ON st.household_id=s.household_id
 AND st.user_id=s.user_id AND st.month_on=s.month_on
LEFT JOIN wins w ON w.household_id=s.household_id
 AND w.user_id=s.user_id AND w.month_on=s.month_on;

CREATE VIEW monthly_achievement_eligible AS
SELECT household_id,user_id,month_on,'first' AS badge_id,5 AS points
FROM monthly_achievement_progress WHERE task_done>=1
UNION ALL
SELECT household_id,user_id,month_on,'routines',15
FROM monthly_achievement_progress WHERE routine_done>=5
UNION ALL
SELECT household_id,user_id,month_on,'challenge',20
FROM monthly_achievement_progress WHERE weekly_wins>=1
UNION ALL
SELECT household_id,user_id,month_on,'master',35
FROM monthly_achievement_progress WHERE task_done>=20
UNION ALL
SELECT household_id,user_id,month_on,'pet',45
FROM monthly_achievement_progress WHERE pet_care_done>=10
UNION ALL
SELECT household_id,user_id,month_on,'streak',60
FROM monthly_achievement_progress WHERE longest_streak>=7;

-- On source changes: grant once per month and immediately revoke only bonuses
-- whose supporting records no longer qualify. Duplicate saves never pay twice.
CREATE TRIGGER monthly_achievement_task_added AFTER INSERT ON completion_points
WHEN NEW.visibility='household'
BEGIN
 INSERT OR IGNORE INTO monthly_achievement_awards
 (household_id,user_id,month_on,badge_id,points,awarded_at)
 SELECT e.household_id,e.user_id,e.month_on,e.badge_id,e.points,
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM monthly_achievement_eligible e
 WHERE e.household_id=NEW.household_id AND e.user_id=NEW.earner_user_id
   AND e.month_on=strftime('%Y-%m',NEW.earned_at,'+9 hours');
END;
CREATE TRIGGER monthly_achievement_task_removed AFTER DELETE ON completion_points
WHEN OLD.visibility='household'
BEGIN
 DELETE FROM monthly_achievement_awards
 WHERE household_id=OLD.household_id AND user_id=OLD.earner_user_id
   AND month_on=strftime('%Y-%m',OLD.earned_at,'+9 hours')
   AND NOT EXISTS (
     SELECT 1 FROM monthly_achievement_eligible e
     WHERE e.household_id=monthly_achievement_awards.household_id
       AND e.user_id=monthly_achievement_awards.user_id
       AND e.month_on=monthly_achievement_awards.month_on
       AND e.badge_id=monthly_achievement_awards.badge_id
   );
END;
CREATE TRIGGER monthly_achievement_task_visibility AFTER UPDATE OF visibility ON completion_points
WHEN OLD.visibility<>NEW.visibility
BEGIN
 DELETE FROM monthly_achievement_awards
 WHERE household_id=OLD.household_id AND user_id=OLD.earner_user_id
   AND month_on=strftime('%Y-%m',OLD.earned_at,'+9 hours')
   AND NOT EXISTS (
     SELECT 1 FROM monthly_achievement_eligible e
     WHERE e.household_id=monthly_achievement_awards.household_id
       AND e.user_id=monthly_achievement_awards.user_id
       AND e.month_on=monthly_achievement_awards.month_on
       AND e.badge_id=monthly_achievement_awards.badge_id
   );
 INSERT OR IGNORE INTO monthly_achievement_awards
 (household_id,user_id,month_on,badge_id,points,awarded_at)
 SELECT e.household_id,e.user_id,e.month_on,e.badge_id,e.points,
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM monthly_achievement_eligible e
 WHERE e.household_id=NEW.household_id AND e.user_id=NEW.earner_user_id
   AND e.month_on=strftime('%Y-%m',NEW.earned_at,'+9 hours');
END;
CREATE TRIGGER monthly_achievement_week_won AFTER INSERT ON weekly_challenge_awards
BEGIN
 INSERT OR IGNORE INTO monthly_achievement_awards
 (household_id,user_id,month_on,badge_id,points,awarded_at)
 SELECT e.household_id,e.user_id,e.month_on,e.badge_id,e.points,
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM monthly_achievement_eligible e
 WHERE e.household_id=NEW.household_id AND e.user_id=NEW.user_id
   AND e.month_on=strftime('%Y-%m',NEW.awarded_at,'+9 hours');
END;
CREATE TRIGGER monthly_achievement_week_revoked AFTER DELETE ON weekly_challenge_awards
BEGIN
 DELETE FROM monthly_achievement_awards
 WHERE household_id=OLD.household_id AND user_id=OLD.user_id
   AND month_on=strftime('%Y-%m',OLD.awarded_at,'+9 hours')
   AND NOT EXISTS (
     SELECT 1 FROM monthly_achievement_eligible e
     WHERE e.household_id=monthly_achievement_awards.household_id
       AND e.user_id=monthly_achievement_awards.user_id
       AND e.month_on=monthly_achievement_awards.month_on
       AND e.badge_id=monthly_achievement_awards.badge_id
   );
END;

-- One-time adoption: recognize progress already achieved THIS month only.
-- Never grant historical months retroactively.
INSERT OR IGNORE INTO monthly_achievement_awards
(household_id,user_id,month_on,badge_id,points,awarded_at)
SELECT e.household_id,e.user_id,e.month_on,e.badge_id,e.points,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM monthly_achievement_eligible e
WHERE e.month_on=strftime('%Y-%m','now','+9 hours');
