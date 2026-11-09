-- Keep archived anniversaries distinct from recycled/deleted records.
ALTER TABLE anniversaries ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_anniversaries_archive
  ON anniversaries(household_id,archived_at,event_date)
  WHERE deleted_at IS NULL;
