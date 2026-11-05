-- Non-destructive soft-deletion for primary plans: preserve linked finances, photos and history.
ALTER TABLE routines ADD COLUMN deleted_at TEXT;
ALTER TABLE anniversaries ADD COLUMN deleted_at TEXT;
ALTER TABLE wishes ADD COLUMN deleted_at TEXT;
ALTER TABLE goals ADD COLUMN deleted_at TEXT;
ALTER TABLE shopping_items ADD COLUMN deleted_at TEXT;
ALTER TABLE trips ADD COLUMN deleted_at TEXT;
ALTER TABLE memories ADD COLUMN deleted_at TEXT;
