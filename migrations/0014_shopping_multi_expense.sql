-- Additive shopping expense links; no kakebo write, no historical data rewrite.
CREATE TABLE IF NOT EXISTS shopping_expense_links (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  shopping_id TEXT NOT NULL REFERENCES shopping_items(id) ON DELETE CASCADE,
  external_entry_id TEXT NOT NULL,
  linked_by TEXT NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(shopping_id,external_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_links_household
  ON shopping_expense_links(household_id,shopping_id);
-- Copy existing single-link references, preserving every old shopping row.
INSERT OR IGNORE INTO shopping_expense_links
  (household_id,shopping_id,external_entry_id,linked_by,linked_at)
SELECT household_id,id,ledger_entry_id,COALESCE(completed_by,created_by),
       COALESCE(completed_at,CURRENT_TIMESTAMP)
FROM shopping_items WHERE ledger_entry_id IS NOT NULL AND ledger_entry_id<>'';
-- Old portable ZIPs only contain shopping_items.ledger_entry_id.
CREATE TRIGGER IF NOT EXISTS restore_legacy_shopping_link
AFTER INSERT ON shopping_items WHEN NEW.ledger_entry_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO shopping_expense_links
    (household_id,shopping_id,external_entry_id,linked_by,linked_at)
  VALUES(NEW.household_id,NEW.id,NEW.ledger_entry_id,
         COALESCE(NEW.completed_by,NEW.created_by),
         COALESCE(NEW.completed_at,CURRENT_TIMESTAMP));
END;
