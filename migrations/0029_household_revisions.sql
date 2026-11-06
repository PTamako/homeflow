-- 0029: indexed, household-scoped invalidation counter for active family PWAs.
-- Additive: no existing household or personal records are modified.
CREATE TABLE IF NOT EXISTS household_revisions (
 household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
