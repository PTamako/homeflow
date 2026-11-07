-- Monthly achievement award weights: total 100, preserving all issued badge records.
-- 0039's original points column is legacy audit data with an immutable CHECK;
-- this view is the canonical *effective payout* for XP, spendable wallet, and rankings.
-- Existing and future monthly badges are revalued without deleting or re-awarding them.
CREATE VIEW monthly_achievement_credits AS
SELECT household_id,user_id,month_on,badge_id,
 CASE badge_id
   WHEN 'first' THEN 5
   WHEN 'routines' THEN 10
   WHEN 'challenge' THEN 15
   WHEN 'master' THEN 20
   WHEN 'pet' THEN 25
   WHEN 'streak' THEN 25
 END AS points,awarded_at
FROM monthly_achievement_awards;
