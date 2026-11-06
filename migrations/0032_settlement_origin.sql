-- Record whether a savings period was confirmed by a member or settled by cron.
-- Historical records default to scheduled; no financial values are changed.
ALTER TABLE goal_period_settlements ADD COLUMN settlement_origin TEXT NOT NULL DEFAULT 'scheduled'
  CHECK(settlement_origin IN ('scheduled','manual'));
