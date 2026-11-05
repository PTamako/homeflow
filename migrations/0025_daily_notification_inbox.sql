-- Notification inbox is separate from delivery deduplication and all task/plan records.
-- Daily-only retention: scheduled cleanup removes prior JST dates; the API never exposes them.
CREATE TABLE IF NOT EXISTS notification_inbox (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('family','task','routine','shopping','system')),
  source_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('sent','partial','failed')),
  sent_devices INTEGER NOT NULL DEFAULT 0,
  failed_devices INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  local_day TEXT NOT NULL,
  read_at TEXT,
  dedupe_key TEXT,
  UNIQUE(recipient_user_id,local_day,dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_inbox_recipient_today
  ON notification_inbox(recipient_user_id,local_day,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_notification_inbox_sender_today
  ON notification_inbox(sender_user_id,local_day,created_at DESC,id DESC);
