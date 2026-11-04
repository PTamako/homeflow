-- Stage 1 pet history, additive. Requires stages 0001 through 0005.
CREATE TABLE IF NOT EXISTS pet_health_records (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES family_profiles(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  record_type TEXT NOT NULL CHECK(record_type IN ('weight','deworm','vaccination','vet','medication','grooming','other')),
  event_on TEXT NOT NULL,
  weight_grams INTEGER CHECK(weight_grams IS NULL OR (weight_grams>0 AND weight_grams<100000)),
  note TEXT NOT NULL DEFAULT '',
  next_due_on TEXT,
  linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pet_health_profile ON pet_health_records(household_id,profile_id,event_on DESC);
