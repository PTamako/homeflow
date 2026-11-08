-- 0045: Remove the previously-introduced 120-day trip reward ceiling.
-- Keep 0044 event immutability, historical awards, and the reversal trigger intact.
-- The API requires an explicit acknowledgement for new completions over 30 days.
DROP TRIGGER IF EXISTS trip_reward_award_on_completion;
CREATE TRIGGER trip_reward_award_on_completion
AFTER UPDATE OF status ON trips
WHEN OLD.status<>'completed' AND NEW.status='completed'
  AND NEW.trip_rewarded_at IS NOT NULL AND NEW.deleted_at IS NULL
  AND NEW.start_on IS NOT NULL AND NEW.end_on IS NOT NULL
  AND NEW.end_on>=NEW.start_on
BEGIN
  INSERT INTO trip_reward_events
    (id,trip_id,household_id,user_id,visibility,points,awarded_at)
  SELECT lower(hex(randomblob(16))),NEW.id,NEW.household_id,j.value,
    NEW.visibility,
    CAST(julianday(NEW.end_on)-julianday(NEW.start_on)+1 AS INTEGER)*10,
    NEW.trip_rewarded_at
  FROM json_each(NEW.participant_user_ids) j
  JOIN household_members m ON m.household_id=NEW.household_id AND m.user_id=j.value
  WHERE NEW.visibility='household' OR j.value=NEW.created_by;
END;
