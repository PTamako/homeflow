-- Additive, nullable assignment. Existing shopping and ledger associations remain unchanged.
-- NULL = unassigned; household-shared plans may remind both accounts.
ALTER TABLE shopping_items ADD COLUMN assigned_to TEXT REFERENCES users(id);
