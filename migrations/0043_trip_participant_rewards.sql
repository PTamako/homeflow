-- Travel participants are account IDs, not free-text labels from imported trip JSON.
-- Existing trips default to their creator; historical completed trips never gain
-- rewards until their owner reopens and completes them after this migration.
ALTER TABLE trips ADD COLUMN participant_user_ids TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(participant_user_ids) AND json_type(participant_user_ids)='array');
ALTER TABLE trips ADD COLUMN trip_rewarded_at TEXT;
UPDATE trips SET participant_user_ids=json_array(created_by);

-- This is a projection of the currently valid completion rather than a
-- second mutable balance. Undo, delete, or edit recalculates automatically.
-- DATE math is inclusive: a three-day trip awards each traveler 30 points.
CREATE VIEW trip_completion_rewards AS
SELECT t.id AS trip_id,t.household_id,j.value AS user_id,t.visibility,
  CAST(julianday(t.end_on)-julianday(t.start_on)+1 AS INTEGER)*10 AS points,
  t.trip_rewarded_at AS awarded_at
FROM trips t
JOIN json_each(t.participant_user_ids) j
JOIN household_members hm ON hm.household_id=t.household_id AND hm.user_id=j.value
WHERE t.status='completed' AND t.deleted_at IS NULL
  AND t.trip_rewarded_at IS NOT NULL
  AND t.start_on IS NOT NULL AND t.end_on IS NOT NULL
  AND t.end_on>=t.start_on AND t.end_on<=date('now','+9 hours')
  AND (t.visibility='household' OR (t.visibility='private' AND j.value=t.created_by));
