-- 0044: immutable per-completion travel award snapshots.
-- Earned points never change merely because an itinerary or participant list is edited.
-- Reopening a completed trip records an explicit reversal; completing again is a new event.
CREATE TABLE trip_reward_events (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  points INTEGER NOT NULL CHECK(points>=0),
  awarded_at TEXT NOT NULL,
  reversed_at TEXT
);
CREATE INDEX idx_trip_reward_events_member ON trip_reward_events(household_id,user_id,reversed_at);
CREATE INDEX idx_trip_reward_events_trip_active ON trip_reward_events(trip_id,reversed_at);
-- Preserve already-granted legacy rewards without retroactively imposing the new cap.
INSERT INTO trip_reward_events
  (id,trip_id,household_id,user_id,visibility,points,awarded_at)
SELECT lower(hex(randomblob(16))),r.trip_id,r.household_id,r.user_id,r.visibility,r.points,r.awarded_at
FROM trip_completion_rewards r;
DROP VIEW trip_completion_rewards;
CREATE VIEW trip_completion_rewards AS
SELECT e.trip_id,e.household_id,e.user_id,e.visibility,e.points,e.awarded_at
FROM trip_reward_events e
JOIN trips t ON t.id=e.trip_id AND t.household_id=e.household_id
WHERE e.reversed_at IS NULL AND t.status='completed' AND t.deleted_at IS NULL;
-- An award snapshot is written atomically with the trip's completion transition.
-- The 120-day reward ceiling prevents a mistakenly year-long plan from minting
-- thousands of points. A long trip may still be completed normally.
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
    MIN(120,CAST(julianday(NEW.end_on)-julianday(NEW.start_on)+1 AS INTEGER))*10,
    NEW.trip_rewarded_at
  FROM json_each(NEW.participant_user_ids) j
  JOIN household_members m ON m.household_id=NEW.household_id AND m.user_id=j.value
  WHERE NEW.visibility='household' OR j.value=NEW.created_by;
END;
CREATE TRIGGER trip_reward_reverse_on_reopen
AFTER UPDATE OF status ON trips
WHEN OLD.status='completed' AND NEW.status<>'completed'
BEGIN
  UPDATE trip_reward_events SET reversed_at=CURRENT_TIMESTAMP
  WHERE trip_id=NEW.id AND reversed_at IS NULL;
END;
