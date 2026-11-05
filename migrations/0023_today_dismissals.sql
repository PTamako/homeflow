-- Private, per-day hiding of Today rows. Never soft-delete the source plan/task.
-- Composite primary key is also the lookup index; no cleanup cron or bulk writes.
CREATE TABLE IF NOT EXISTS today_dismissals (
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  view_on TEXT NOT NULL,
  item_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (household_id,user_id,view_on,item_key)
);
