-- Stage 2 notification delivery, add on Preview before production.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  endpoint_hash TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  sent_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed','sent','failed','gone')),
  status_code INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(endpoint_hash,notification_key,sent_on)
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_purge ON notification_deliveries(sent_on);
