-- Add only the HomeFlow-side reference to a user-selected kakebo expense.
-- All source transaction details remain in the kakebo D1 database.
ALTER TABLE shopping_items ADD COLUMN ledger_entry_id TEXT;
