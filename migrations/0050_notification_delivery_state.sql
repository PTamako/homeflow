-- Only today's inbox state CHECK changes; preserve all IDs, read flags and dedupe history.
-- Old failed+0/0 meant no device attempted, but the reason was not stored.
CREATE TABLE notification_inbox_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('family','task','routine','shopping','system')),
  source_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('sent','partial','failed','quiet','app_only')),
  sent_devices INTEGER NOT NULL DEFAULT 0,
  failed_devices INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  local_day TEXT NOT NULL,
  read_at TEXT,
  dedupe_key TEXT,
  last_completion_key TEXT,
  UNIQUE(recipient_user_id,local_day,dedupe_key)
);
INSERT INTO notification_inbox_new
  (id,household_id,sender_user_id,recipient_user_id,kind,source_id,title,message,
   delivery_status,sent_devices,failed_devices,created_at,local_day,read_at,dedupe_key,last_completion_key)
SELECT id,household_id,sender_user_id,recipient_user_id,kind,source_id,title,message,
       CASE WHEN delivery_status='failed' AND sent_devices=0 AND failed_devices=0
         THEN 'app_only' ELSE delivery_status END,
       sent_devices,failed_devices,created_at,local_day,read_at,dedupe_key,last_completion_key
FROM notification_inbox;
DROP TABLE notification_inbox;
ALTER TABLE notification_inbox_new RENAME TO notification_inbox;
CREATE INDEX idx_notification_inbox_recipient_today
  ON notification_inbox(recipient_user_id,local_day,created_at DESC,id DESC);
CREATE INDEX idx_notification_inbox_sender_today
  ON notification_inbox(sender_user_id,local_day,created_at DESC,id DESC);
