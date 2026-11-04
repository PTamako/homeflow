-- Add a pet-care sync option to recurring rules. Only newly completed days generate records.
-- Apply Preview before deploying this change; apply Production only after verification.
ALTER TABLE routines ADD COLUMN health_record_type TEXT
  CHECK(health_record_type IS NULL OR health_record_type IN
    ('deworm','vaccination','vet','medication','grooming','other'));
ALTER TABLE pet_health_records ADD COLUMN source_routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL;
ALTER TABLE pet_health_records ADD COLUMN source_occurrence_on TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pet_health_routine_occurrence
  ON pet_health_records(source_routine_id,source_occurrence_on)
  WHERE source_routine_id IS NOT NULL;
