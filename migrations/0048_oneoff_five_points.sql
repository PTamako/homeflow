-- From this migration onward every one-off completion earns 5 base points,
-- whether assigned or unassigned. Routines remain 5; separately funded bonuses
-- are unaffected. Do not backfill prior completion events.
DROP TRIGGER IF EXISTS points_adjust_new_completion;
CREATE TRIGGER points_adjust_new_completion AFTER INSERT ON completion_points
WHEN NEW.kind IN ('task','routine')
BEGIN
  INSERT OR IGNORE INTO completion_point_adjustments
    (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,delta,earned_at)
  VALUES(NEW.household_id,NEW.kind,NEW.source_id,NEW.occurrence_on,
    NEW.earner_user_id,NEW.visibility,-5,NEW.earned_at);
END;
