-- 0030: isolated per-account sync counters; additive and no existing rows updated.
CREATE TABLE IF NOT EXISTS member_revisions (
 household_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(household_id,user_id),
 FOREIGN KEY(household_id,user_id) REFERENCES household_members(household_id,user_id) ON DELETE CASCADE
);
