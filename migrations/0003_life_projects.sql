-- Stage 2-5, additive and empty by default. Apply to Preview first.
CREATE TABLE IF NOT EXISTS anniversaries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  subject_profile_id TEXT REFERENCES family_profiles(id),
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  repeat_mode TEXT NOT NULL CHECK(repeat_mode IN ('once','yearly','monthly')),
  advance_days_json TEXT NOT NULL DEFAULT '[7,1,0]',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_anniversaries_household ON anniversaries(household_id,event_date);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  assigned_to TEXT REFERENCES users(id),
  subject_profile_id TEXT REFERENCES family_profiles(id),
  title TEXT NOT NULL,
  repeat_type TEXT NOT NULL CHECK(repeat_type IN ('daily','weekly','monthly','interval')),
  repeat_config TEXT NOT NULL DEFAULT '{}',
  anchor_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_routines_household ON routines(household_id,enabled);
CREATE TABLE IF NOT EXISTS routine_marks (
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  occurrence_on TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  skipped_at TEXT,
  PRIMARY KEY (routine_id,occurrence_on)
);
CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  title TEXT NOT NULL,
  wish_type TEXT NOT NULL CHECK(wish_type IN ('trip','purchase','activity','other')),
  status TEXT NOT NULL DEFAULT 'wished' CHECK(status IN ('wished','planning','active','completed','cancelled')),
  estimated_amount INTEGER NOT NULL DEFAULT 0 CHECK(estimated_amount>=0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wishes_household ON wishes(household_id,status);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  wish_id TEXT UNIQUE REFERENCES wishes(id),
  title TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  start_on TEXT,
  end_on TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  budget_amount INTEGER NOT NULL DEFAULT 0 CHECK(budget_amount>=0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','completed','cancelled')),
  import_source_key TEXT,
  import_hash TEXT,
  plan_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(household_id,import_source_key)
);
CREATE INDEX IF NOT EXISTS idx_trips_household_start ON trips(household_id,start_on);
CREATE TABLE IF NOT EXISTS trip_progress (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  PRIMARY KEY(trip_id,item_id)
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  wish_id TEXT REFERENCES wishes(id),
  title TEXT NOT NULL,
  target_amount INTEGER NOT NULL CHECK(target_amount>0),
  reserved_amount INTEGER NOT NULL DEFAULT 0 CHECK(reserved_amount>=0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  target_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_goals_household ON goals(household_id,created_by);
CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 9999),
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopping_household ON shopping_items(household_id,completed_at);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  title TEXT NOT NULL,
  story TEXT NOT NULL DEFAULT '',
  happened_on TEXT NOT NULL,
  linked_type TEXT CHECK(linked_type IN ('trip','wish','profile','anniversary') OR linked_type IS NULL),
  linked_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_memories_household_time ON memories(household_id,happened_on DESC);
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','household')),
  memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 5242880),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_media_memory ON media_assets(memory_id);
-- Bookkeeping never writes into HomeFlow; only references manually approved ledger IDs.
CREATE TABLE IF NOT EXISTS finance_links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('trip','goal')),
  target_id TEXT NOT NULL,
  external_entry_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(household_id,target_type,target_id,external_entry_id)
);
