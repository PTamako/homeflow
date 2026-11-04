-- Enables default-on care history for pet-linked one-off tasks.
-- Additive to migrations 0001-0009; apply to Preview first, then Production before new Worker code.
ALTER TABLE tasks ADD COLUMN health_record_type TEXT
  CHECK(health_record_type IS NULL OR health_record_type IN ('deworm','vaccination','vet','medication','grooming','other'));
ALTER TABLE pet_health_records ADD COLUMN source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pet_health_source_task ON pet_health_records(source_task_id);
-- Existing pet-linked tasks start syncing on their NEXT completion; past marks are never fabricated.
UPDATE tasks SET health_record_type='other'
 WHERE subject_profile_id IN (SELECT id FROM family_profiles WHERE type='pet' AND archived_at IS NULL)
   AND deleted_at IS NULL AND health_record_type IS NULL;
