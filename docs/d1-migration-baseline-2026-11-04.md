# D1 historical migration baseline — 2026-11-04 JST

## Verified environments
- Production: D1 `homeflow` (`3e0205b0-77e2-4259-8ac2-4c56efc43f8a`).
- Preview: D1 `homeflow-preview` (`da6d49ab-ae80-4bb0-a2d0-18379ebc7d92`).
- Both instances are isolated. Neither contained a `d1_migrations` table before baseline reconciliation.
- Original 0001–0019 SQL was already executed manually and through targeted fixes before enabling Wrangler tracking.

## Read-only schema inspection performed
Both databases were inspected with `sqlite_master`, `PRAGMA table_info`, and two aggregate postcondition queries:
- Every expected HomeFlow table, secondary index and cleanup/compatibility trigger was present.
- Every added column from historical `ALTER TABLE` operations was present.
- Shopping records with a legacy ledger ID but no corresponding `shopping_expense_links` row: **0**.
- Active pet-linked tasks eligible for migration 0010's backfill but still missing `health_record_type`: **0**.
- No user records were read or written during this review; only schema metadata and aggregate counts.

## Wrangler tracking reconciliation
Wrangler's documented `d1_migrations` schema is:
```sql
CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

After the above checks passed for **each** isolated database, the migration names defined in `scripts/check_migrations.py` were registered as an **administrative tracking baseline**. The legacy `ALTER`, `UPDATE`, backfill `INSERT`, and `CREATE TRIGGER` statements were **not replayed**. This tracking entry indicates that the postconditions are observed, not that Wrangler historically applied those files or that byte-for-byte constraints have been reconstructed.

The migration prefix `0009` appears in **two** legitimate filenames. Wrangler tracks the full filename, not just the numeric prefix. Never deduplicate one of them.

## Rules for future changes
1. Add a new immutable, numbered, additive SQL file; update `scripts/check_migrations.py` and integration fixtures.
2. Validate the clean SQLite migration chain in CI and check affected schema objects on Preview.
3. Explicitly apply any **new**, unrecorded migration to Preview first, then Production, checking that the official `d1_migrations` list and resulting schema agree. Prefer Wrangler's `d1 migrations list`/`apply` with an explicit remote database name once the baseline is reconciled.
4. Never run all historical `*.sql` manually, never blindly retry an `ALTER TABLE ADD COLUMN`, and never apply Production migrations against Preview's D1 ID.
5. Deployment is a separate operation; rollback of Worker code does **not** roll back D1 schema. Use D1 point-in-time recovery planning before destructive changes.
6. Keep the existing free-tier cost discipline: evaluate indexing changes using read-only `EXPLAIN QUERY PLAN`, use five-row keyset pages, and avoid polls/scheduled scans without a use case.

## Verification query
```sql
SELECT name, applied_at FROM d1_migrations ORDER BY id;
```

All migration filenames in `scripts/check_migrations.py` must appear **exactly once** in each environment. CI's local migration replay is only for an empty disposable SQLite test database.
