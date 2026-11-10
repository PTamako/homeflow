-- Raise monthly household achievement thresholds without rewriting history.
-- Complete records are counted as before; only eligibility changes.
-- Use the old immutable points values for legacy award rows; effective payouts
-- continue to come from monthly_achievement_credits (100 points across 6 badges).
DROP VIEW monthly_achievement_eligible;
CREATE VIEW monthly_achievement_eligible AS
WITH badge_rules(badge_id,points,metric,target) AS (
 VALUES ('first',5,'tasks',1),
        ('routines',15,'routines',5),
        ('challenge',20,'weekly',1),
        ('master',35,'tasks',30),
        ('pet',45,'pet',15),
        ('streak',60,'streak',14)
)
SELECT p.household_id,p.user_id,p.month_on,b.badge_id,b.points
FROM monthly_achievement_progress p CROSS JOIN badge_rules b
WHERE (b.metric='tasks' AND p.task_done>=b.target)
   OR (b.metric='routines' AND p.routine_done>=b.target)
   OR (b.metric='weekly' AND p.weekly_wins>=b.target)
   OR (b.metric='pet' AND p.pet_care_done>=b.target)
   OR (b.metric='streak' AND p.longest_streak>=b.target);

-- Reconcile ONLY the current JST month. Previously earned months remain intact.
-- Remove badges that no longer meet the new eligibility rules so they no
-- longer count toward spendable points, contribution or XP.
DELETE FROM monthly_achievement_awards
WHERE month_on=strftime('%Y-%m','now','+9 hours')
  AND badge_id IN ('master','pet','streak')
  AND NOT EXISTS (
    SELECT 1 FROM monthly_achievement_eligible e
    WHERE e.household_id=monthly_achievement_awards.household_id
      AND e.user_id=monthly_achievement_awards.user_id
      AND e.month_on=monthly_achievement_awards.month_on
      AND e.badge_id=monthly_achievement_awards.badge_id
  );

-- Award users who already satisfy the stricter thresholds this month.
-- The primary key prevents duplicate awards, including on migrations replay.
INSERT OR IGNORE INTO monthly_achievement_awards
(household_id,user_id,month_on,badge_id,points,awarded_at)
SELECT e.household_id,e.user_id,e.month_on,e.badge_id,e.points,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM monthly_achievement_eligible e
WHERE e.month_on=strftime('%Y-%m','now','+9 hours')
  AND e.badge_id IN ('master','pet','streak');
