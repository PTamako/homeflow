-- Wish notifications are opt-in and independent of the account-wide task lead.
-- Existing wishes remain silent; no goal, wish or completion row is rewritten.
ALTER TABLE wishes ADD COLUMN remind_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(remind_enabled IN (0,1));
ALTER TABLE wishes ADD COLUMN remind_advance_days INTEGER NOT NULL DEFAULT 0
  CHECK(remind_advance_days IN (0,1,3,7));
